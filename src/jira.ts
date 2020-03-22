import fetch from "node-fetch"

export type Paged = {
    startAt: number
    maxResults: number
    total: number
    isLast: boolean
}

export type User = {
    active: boolean
    accountType: string     // atlassian
    accountId: string       // 557058:5e28f02b-6cd3-4147-aa81-15550f212d03
    displayName: string     // James Bond
    emailAddress: string    // james.bond@gmail.com
    timeZone: string        // Europe/Amsterdam
    locale: string          // en_US
}

export type Field = {
    id: string              // customfield_16295
    key: string             // customfield_16295
    name: string            // WBSO CY
    custom: boolean
    schema: {
        type: string        // string
        customId: number    // 16295
    }
}

export enum Fields {
    status = "status",
    assignee = "assignee"
}

export enum Status {
    "In Progress" = "3",
    "Feature test" = "10003"
}

export type Issue = {
    id: string
    key: string
    fields: { [key: string]: any }
    changelog: Paged & {
        histories: History[]
    }
}

export type History = {
    id: string
    author: User
    created: string
    items: HistoryItem[]
}

// items: [{
//     fieldtype: "jira",
//     fieldId: "assignee",
//     from: null,
//     fromString: null,
//     to: "557058:5e28f02b-6cd3-4147-aa81-15550f212d03",
//     toString: "Sergii Kolbasin"
// }, {
//     fieldtype: "jira",
//     fieldId: "status",
//     from: "13520",
//     fromString: "Selected for Development",
//     to: "3",
//     toString: "In Progress"
// }]

export type HistoryItem = {
    fieldtype: string
    fieldId: string
    from: string | null
    fromString: string | null
    to: string | null
    toString: string | null
}

export function createClient(options: { debug: boolean, baseUrl: string, username: string, password: string }) {
    const DEBUG = options.debug
    const JIRA_BASEURL = options.baseUrl
    const JIRA_AUTH = "Basic " + btoa(options.username + ":" + options.password)

    // https://developer.atlassian.com/server/jira/platform/rest-apis/
    // https://docs.atlassian.com/software/jira/docs/api/REST/8.7.1/

    return { rest, paged, status, fields, fieldsExist, search, getUser, getIssue, getChangelog }

    function rest(url: string) {
        DEBUG && console.log("JIRA:REST", url)
        return fetch(JIRA_BASEURL + url, {
            headers: {
                "Authorization": JIRA_AUTH,
                "Accept": "application/json",
                "Content-Type": "application/json",
            }
        }).then(r => r.ok ? r.json() : r.text().then(reason => Promise.reject(`${r.status} ${r.statusText} ${url}\n${reason}`)))
    }

    async function paged<R>(ajax: (q: { startAt: number, maxResults: number }) => Promise<Paged>, data: string, options?: any): Promise<R[]> {
        const params = {...options,  startAt: 0, maxResults: 100}
        const ans: R[] = []
        for (;;) {
            const result = await ajax(params)
            ans.push(...(result as any)[data])
            if (result.isLast || result.startAt + result.maxResults >= result.total) {
                break
            }
            params.startAt += params.maxResults
        }
        return ans
    }

    function status(options?: any): Promise<any[]> {
        return rest(`2/status${qs(options)}`)
    }

    function fields(options?: any): Promise<Field[]> {
        return rest(`2/field${qs(options)}`)
    }

    async function fieldsExist(fields: Field[], join: string, issue: Issue) {
        if (fields.some(f => !!issue.fields[f.id])) return true
        const keys = [ issue.key, issue.fields?.parent?.key ].filter(e => !!e)
        const jql = "(" + fields.map(e => `cf[${e.schema.customId}] IS NOT EMPTY`).join(` ${join} `) + `) AND id IN (${keys.join(",")})`
        const result = await search(jql, { fields: "id,key" })
        return result.total > 0
    }

    // https://developer.atlassian.com/server/jira/platform/jira-rest-api-example-query-issues-6291606/
    function search(jql: string, options?: any): Promise<Paged & { issues: Issue[] }> {
        // options = { jql: "assignee = currentUser() ORDER BY updated DESC", ...options}
        options.jql = jql
        return rest(`2/search${qs(options)}`)
    }

    async function getUser(username: string, project: string = "20880"): Promise<User> {
        const json = await rest(`2/user/assignable/search${qs({ project, username })}`)
        return json.length === 1 ? json[0] as User : Promise.reject("NOT_FOUND")
    }

    // https://confluence.atlassian.com/adminjiraserver/issue-fields-and-statuses-938847116.html
    async function getIssue(id: string, options?: any): Promise<Issue> {
        return rest(`2/issue/${id}${qs(options)}`)
    }

    // https://confluence.atlassian.com/jirakb/jira-cloud-rest-api-limits-the-number-of-changelogs-returned-938840277.html?_ga=2.228062045.1998532383.1584274557-1754841096.1581589157
    async function getChangelog(issueId: string, options?: any): Promise<Paged & { values: History[] }> {
        return rest(`2/issue/${issueId}/changelog${qs(options)}`)
    }
}

function btoa(text: string): string {
    return Buffer.from(text).toString("base64")
}

function qs(params: any): string {
    if (typeof params === "object" && params) {
        const ans = Object.keys(params).map(key => {
            let value = params[key]
            if (typeof value === "string") {
                value = value.replace(/\s+/ig, "+")
            }
            return `${key}=${value}`
        }).join("&")
        if (ans) return "?" + ans
    }
    return ""
}