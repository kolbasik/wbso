import { config as dotenv } from "dotenv"
import * as yargs from "yargs"
import * as Timesheet from "./timesheet"
import * as ts from "./date"
import * as JIRA from "./jira"
import * as Outlook from "./outlook"

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
    const timesheet = await Timesheet.compute({ debug, tickets, meetings, computeDays })
    console.dir(timesheet, { depth: 3 })
}

async function searchTickets({ debug, email, searchDays }: { debug: boolean, email: string, searchDays: number }): Promise<Timesheet.Ticket[]> {
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

    const tasks: Timesheet.Ticket[] = []

    for (const issue of issues) {
        debug && console.log("JIRA:ISSUE", issue.key)
        const { changelog } = issue
        // ensure that we have the full history otherwise to fetch all
        if (changelog.maxResults < changelog.total) {
            changelog.histories = await jira.paged<JIRA.History>(q => jira.getChangelog(issue.id, q), "values")
        }
        let state: Timesheet.Ticket & { assignee: string | null, status: string | null } = {
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

async function searchMeetings({ debug, email, searchDays }: { debug: boolean, email: string, searchDays: number }): Promise<Timesheet.Meeting[]> {
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
