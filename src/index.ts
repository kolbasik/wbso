import { config as dotenv } from "dotenv"
import * as yargs from "yargs"
import * as ts from "./date"
import * as JIRA from "./jira"

dotenv()

const Hours = Object.freeze({
    Working: 8,
    Lunch: 1
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

start(argv as any).catch(e => console.error(e))

async function start({ debug, email, searchDays, computeDays }: { debug: boolean, email: string, searchDays: number, computeDays: number }) {
    debug && console.info("email:", email)
    const tickets = await searchTickets({ debug, email, searchDays })
    debug && console.group("timesheet:")
    const timesheet = await createTimesheet({ tickets, computeDays })
    console.dir(timesheet, { depth: 3 })
    debug && console.groupEnd()
}

type Ticket = { issue: string, from: Date, to: Date }

async function searchTickets({ debug, email, searchDays }: { debug: boolean, email: string, searchDays: number }): Promise<Ticket[]> {
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

    return tasks.sort((a, b) => b.to.getTime() - a.to.getTime())
}

async function createTimesheet({ tickets, computeDays }: { tickets: Ticket[], computeDays: number }) {
    const today: ts.Interval = { from: ts.today(), to: ts.addHours(Hours.Working + Hours.Lunch, ts.today()) }
    const timesheet = []
    for (let day = 0; day < computeDays; day++) {
        const date: ts.Interval = { from: ts.addDays(-day, today.from), to: ts.addDays(-day, today.to) }
        if (ts.isWorkingDay(date.from)) {
            const tasks = []
            for (const state of tickets) {
                // small ticket within 1 day
                if (ts.date(date.from) === ts.date(state.from) && ts.date(state.from) === ts.date(state.to)) {
                    tasks.push({
                        issue: state.issue,
                        duration: duration(state),
                        from: state.from,
                        to: state.to,
                    })
                    continue
                }
                // long ticket and intersection between days
                const interval = ts.intersect(state, date)
                if (interval !== undefined) {
                    tasks.push({
                        issue: state.issue,
                        duration: duration(interval),
                        from: interval.from,
                        to: interval.to,
                    })
                    continue
                }
            }
            if (tasks.length > 0) {
                const include = limit(round(tasks.reduce((a, e) => a + e.duration, 0)))
                const exclude = 0
                const total = include - exclude
                timesheet.push({ date: date.from, total, include, exclude, tasks })
            }
        }
    }
    return timesheet

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
