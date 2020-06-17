import { config as dotenv } from "dotenv"
import * as yargs from "yargs"
import * as ts from "./date"
import * as Timesheet from "./timesheet"
import * as JIRA from "./jira"
import * as Outlook from "./outlook"

dotenv()

const argv = yargs
    .option("email", { desc: "user email", required: true, string: true })
    .option("searchDays", { alias: "w", desc: "search tickets within the window days", number: true, default: 30  })
    .option("computeDays", { alias: "l", desc: "compute timesheet for the last days", number: true, default: 10 })
    .option("debug", { desc: "log more details to output", boolean: true, default: false })
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
    //debug && console.dir(tickets, { depth: 3 })
    const meetings = await searchMeetings({ debug, email, searchDays: computeDays })
    //debug && console.dir(meetings, { depth: 3 })
    const timesheet = await Timesheet.compute({ debug, tickets, meetings, computeDays })
    console.dir(timesheet, { depth: 3 })
}

async function searchTickets({ debug, email, searchDays }: { debug: boolean, email: string, searchDays: number }): Promise<Timesheet.Ticket[]> {
    debug && console.group("\nSEARCH TICKETS:")
    const todayEnd = ts.dateEnd(ts.now())

    // USER
    const user = await jira.getUser(email)
    debug && console.log(`JIRA:AccountId=${user.accountId}`)

    // WBSO
    const fields = await jira.fields()
    const wbsoFields = fields.filter(e => e.custom && e.name.indexOf("WBSO CY") > -1)
    debug && console.log(`JIRA:WBSO [ ${wbsoFields.map(f => `cf[${f.schema.customId}]="${f.name}"`).join("; ")} ]`)
    const isMarkedAsWBSO = jira.fieldsExist.bind(jira, wbsoFields, "OR")

    // ISSUES
    // https://confluence.atlassian.com/adminjiraserver/issue-fields-and-statuses-938847116.html
    const issues = await jira.paged<JIRA.Issue>(
        q => jira.search(`status WAS "IN PROGRESS" AND assignee WAS "${user.accountId}" AND updated > -${searchDays}d ORDER BY updated DESC`, q),
        "issues",
        { fields: "id,key,summary,parent,created,updated", expand: "changelog" }
    )
    const wbsoIssues = await Promise
        .all(issues.map(issue => isMarkedAsWBSO(issue).then(marked => marked ? issue : null)))
        .then(issues => issues.filter((issue): issue is JIRA.Issue => issue !== null))

    const tasks: Timesheet.Ticket[] = []

    for (const wbsoIssue of wbsoIssues) {
        debug && console.log("JIRA:ISSUE", wbsoIssue.key)
        const { changelog } = wbsoIssue
        // ensure that we have the full history otherwise to fetch all
        if (changelog.maxResults < changelog.total) {
            changelog.histories = await jira.paged<JIRA.History>(q => jira.getChangelog(wbsoIssue.id, q), "values")
        }
        let state: Timesheet.Ticket & { assignee: string | null, status: string | null } = {
            ticket: wbsoIssue.key,
            assignee: null,
            status: null,
            from: ts.parse(wbsoIssue.fields.created),
            to: todayEnd
        }
        const states = [ state ]
        wbsoIssue.changelog.histories
            .sort((a, b) => Number(a.id) - Number(b.id))
            .forEach(history => {
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
                                        to: todayEnd
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
        tasks.push(...states
            .filter(it => it.assignee === user.accountId && it.status && statuses.includes(it.status))
            .map(it => ({ ticket: it.ticket, from: it.from, to: it.to })))
    }

    debug && console.groupEnd()
    return tasks.sort((a, b) => b.to.getTime() - a.to.getTime())
}

async function searchMeetings({ debug, email, searchDays }: { debug: boolean, email: string, searchDays: number }): Promise<Timesheet.Meeting[]> {
    debug && console.group("\nSEARCH MEETINGS:")

    // USER
    const user = await outlook.getUser({ search: email })
    debug && console.log("OUTLOOK:USER", user)

    // MEETINGS
    const to = ts.dateEnd(ts.now())
    const from = ts.addDays(-searchDays, to)
    const events = await outlook.paged<Outlook.Event>(
        q => outlook.getEvents({ userKey: user.userPrincipalName, from, to }, q),
        "value",
        {
            "$select": "id,subject,start,end", // ,organizer,attendees,isAllDay
            "$filter": "showAs eq 'busy' and isCancelled eq false",
        }
    )
    const meetings = events.map(it => ({
        meeting: it.subject,
        from: ts.parse(it.start.dateTime + 'Z'),
        to: ts.parse(it.end.dateTime + 'Z')
    }))

    debug && console.groupEnd()
    return meetings
}
