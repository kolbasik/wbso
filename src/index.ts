import { config as dotenv } from "dotenv"
import * as yargs from "yargs"
import * as ts from "./date"
import * as JIRA from "./jira"
import * as Outlook from "./outlook"
import * as R from 'ramda'

dotenv()

const Hours = Object.freeze({
    Working: 8,
    Lunch: 1,
    Interrupts: 2
})

const argv = yargs
    .option("email", { required: true, alias: "e", desc: "user email" })
    .option("searchDays", { alias: "s", desc: "search days for tickets", number: true, default: 30  })
    .option("computeDays", { alias: "t", desc: "compute days for timesheet", number: true, default: 10 })
    .option("debug", { alias: "d", desc: "log to output more details", boolean: true, default: false })
    .argv

const jira = JIRA.createClient({
    debug: argv.debug,
    baseUrl: process.env.JIRA_BASEURL ?? "https://albumprinter.atlassian.net/rest/api/",
    username: process.env.JIRA_USERNAME ?? "sergii.kolbasin@albelli.com",
    password: process.env.JIRA_PASSWORD ?? ""
})

const outlook = Outlook.createClient({
    debug: argv.debug,
    baseUrl: process.env.OUTLOOK_BASEURL ?? "https://graph.microsoft.com/",
    accessToken: process.env.OUTLOOK_ACCESS_TOKEN ?? "",
})

start(argv as any).catch(e => console.error(e))

async function start({ debug, email, searchDays, computeDays }: { debug: boolean, email: string, searchDays: number, computeDays: number }) {
    debug && console.info("EMAIL:", email)
    const tickets = await searchTickets({ debug, email, searchDays })
    const meetings = await searchMeetings({ debug, email, searchDays: computeDays })
    const timesheet = await createTimesheet({ debug, tickets, meetings, computeDays })
    console.dir(timesheet, { depth: 3 })
}

type Ticket = { issue: string, from: Date, to: Date }
type Meeting = { title: string, from: Date, to: Date }

async function searchTickets({ debug, email, searchDays }: { debug: boolean, email: string, searchDays: number }): Promise<Ticket[]> {
    debug && console.group("\nSEARCH TICKETS:")
    const today: ts.Interval = { from: ts.today(), to: ts.addHours(Hours.Working + Hours.Lunch, ts.today()) }
    const user = await jira.getUser(email)
    debug && console.log(`JIRA:AccountId=${user.accountId}`)

    const fields = await jira.fields()
    const wbsoFields = fields.filter(e => e.custom && e.name.indexOf("WBSO CY") > -1)
    debug && console.log(`JIRA:WBSO [ ${wbsoFields.map(f => `cf[${f.schema.customId}]="${f.name}"`).join("; ")} ]`)
    const isMarkedAsWBSO = jira.fieldsExist.bind(jira, wbsoFields, "OR")

    // https://confluence.atlassian.com/adminjiraserver/issue-fields-and-statuses-938847116.html
    const found = await jira.paged<JIRA.Issue>(
        q => jira.search(`status WAS "IN PROGRESS" AND assignee WAS "${user.accountId}" AND updated > -${searchDays}d ORDER BY updated DESC`, q),
        "issues",
        { fields: "id,key,summary,parent,created,updated", expand: "changelog" }
    )
    const issues = await Promise
        .all(found.map(issue => isMarkedAsWBSO(issue).then(marked => marked ? issue : null)))
        .then(issues => issues.filter((issue): issue is JIRA.Issue => issue !== null))

    const tasks: Ticket[] = []

    for (const issue of issues) {
        debug && console.log("JIRA:ISSUE", issue.key)
        const { changelog } = issue
        // ensure that we have the full history otherwise to fetch all
        if (changelog.maxResults < changelog.total) {
            changelog.histories = await jira.paged<JIRA.History>(q => jira.getChangelog(issue.id, q), "values")
        }
        let state: Ticket & { assignee: string | null, status: string | null } = {
            issue: issue.key,
            assignee: null,
            status: null,
            from: ts.parse(issue.fields.created),
            to: today.to
        }
        const states = [ state ]
        issue.changelog.histories.reverse().forEach(history => {
            history.items.forEach(changed => {
                if (changed.fieldtype === "jira") {
                    switch (changed.fieldId) {
                        case JIRA.Fields.status:
                        case JIRA.Fields.assignee:
                            if (state[changed.fieldId] !== changed.to) {
                                const newState = {
                                    ...state,
                                    [changed.fieldId]: changed.to,
                                    from: ts.parse(history.created),
                                    to: today.to
                                }
                                state.to = newState.from
                                states.push(state = newState)
                            }
                            break;
                        }
                }
            })
        })

        const statuses: string[] = [ JIRA.Status["In Progress"] /*, JIRA.Status["Feature test"] */ ]
        tasks.push(...states.filter(s => s.assignee === user.accountId && s.status && statuses.includes(s.status)))
    }

    debug && console.groupEnd()
    return tasks.sort((a, b) => b.to.getTime() - a.to.getTime())
}

async function searchMeetings({ debug, email, searchDays }: { debug: boolean, email: string, searchDays: number }): Promise<Meeting[]> {
    debug && console.group("\NSEARCH MEETINGS:")
    const outlookUser = await outlook.getUser({ search: email })
    debug && console.log("OUTLOOK:USER", outlookUser)

    const to = ts.addDays(1, ts.date(ts.now()))
    const from = ts.addDays(-searchDays, to)
    const events = await outlook.paged<Outlook.Event>(
        q => outlook.getEvents({ userKey: outlookUser.userPrincipalName, from, to }, q),
        "value",
        {
            "$select": "id,subject,start,end", // ,organizer,attendees,isAllDay
            "$filter": "showAs eq 'busy' and isCancelled eq false",
        }
    )
    const meetings = events.map(e => ({
        title: e.subject,
        from: ts.parse(e.start.dateTime + 'Z'),
        to: ts.parse(e.end.dateTime + 'Z')
    }))

    debug && console.groupEnd()
    return meetings
}

function prepare<T extends { from: Date, to: Date }>(list: T[]) {
    const sort: (e: T[]) => T[] = R.sortBy((e: T) => e.from.getTime())
    const group: (e: T[]) => { [key: string]: T[] } = R.groupBy((e: T) => ts.date(e.from).toISOString().substr(0, 10))
    const result = R.pipe(sort, group)(list)
    console.dir(result)
    return result

    function split(a: T): T[] {
        const result: T[] = []
        let start = ts.date(a.from), end = ts.date(a.to)
        if (start === end) {
            result.push(a)
        } else {
            let r = { ...a }
            r.from = ts.date(r.to)
            let l = { ...a }
            l.to = ts.addSecond(-1, ts.addDays(1, ts.date(l.from)))
            result.push(l)
            l = { ...l, from: ts.addDays(1, l.from), to: ts.addDays(1, l.to) }

            while (l.to < r.from) {
                result.push(l = { ...l, from: ts.addDays(1, l.from), to: ts.addDays(1, l.to) })
            }
            result.push(r)
        }
        return result
    }
}
async function createTimesheet({ debug, tickets, meetings, computeDays }: { debug: boolean, tickets: Ticket[], meetings: Meeting[], computeDays: number }) {
    debug && console.group("\nCOMPUTE TIMESHEET:")

    const sortT: (e: Ticket[]) => Ticket[] = R.sortBy((e: Ticket) => e.from.getTime())
    const groupT: (e: Ticket[]) => { [key: string]: Ticket[] } = R.groupBy((e: Ticket) => ts.date(e.from).toISOString().substr(0, 10))
    const tickets2 = R.pipe(sortT, groupT)(tickets)
    console.dir(tickets2)

    const sortM: (e: Meeting[]) => Meeting[] = R.sortBy((e: Meeting) => e.from.getTime())
    const groupM: (e: Meeting[]) => { [key: string]: Meeting[] } = R.groupBy((e: Meeting) => ts.date(e.from).toISOString().substr(0, 10))
    const meetings2 = R.pipe(sortM, groupM)(meetings)
    console.dir(meetings2)

    // const today: ts.Interval = { from: ts.today(), to: ts.addHours(Hours.Working + Hours.Lunch, ts.today()) }
    // const timesheet = []
    // for (let day = 0; day < computeDays; day++) {
    //     const date: ts.Interval = { from: ts.addDays(-day, today.from), to: ts.addDays(-day, today.to) }
    //     if (ts.isWorkingDay(date.from)) {
    //         const tasks = []
    //         for (const state of tickets) {
    //             // small ticket within 1 day
    //             if (ts.date(date.from) === ts.date(state.from) && ts.date(state.from) === ts.date(state.to)) {
    //                 tasks.push({
    //                     issue: state.issue,
    //                     duration: duration(state),
    //                     from: state.from,
    //                     to: state.to,
    //                 })
    //                 continue
    //             }
    //             // long ticket and intersection between days
    //             const interval = ts.intersect(state, date)
    //             if (interval !== undefined) {
    //                 tasks.push({
    //                     issue: state.issue,
    //                     duration: duration(interval),
    //                     from: interval.from,
    //                     to: interval.to,
    //                 })
    //                 continue
    //             }
    //         }
    //         if (tasks.length > 0) {
    //             const include = limit(round(tasks.reduce((a, e) => a + e.duration, 0)))
    //             const maxWorkingHours = Hours.Working - Hours.Interrupts
    //             const exclude = Math.max(0, include - maxWorkingHours)
    //             const total = include - exclude
    //             timesheet.push({ date: date.from, total, include, exclude, tasks })
    //         }
    //     }
    // }

    debug && console.groupEnd()
    return null // timesheet

    function duration(interval: ts.Interval) {
        let duration = round((interval.to.getTime() - interval.from.getTime()) / (60 * 60 * 1000))
        const threshold = (Hours.Working / 2) + Hours.Lunch
        if (threshold <= duration) duration -= Hours.Lunch
        return limit(duration)
    }

    function round(hours: number) {
        return Math.round(hours * 4) / 4 // round to 15mins
    }

    function limit(hours: number) {
        return Math.min(Hours.Working, hours)
    }
}
