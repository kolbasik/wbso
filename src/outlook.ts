// https://developer.microsoft.com/en-us/graph/graph-explorer#
// https://docs.microsoft.com/en-us/graph/query-parameters

import fetch from "node-fetch"

export type Paged = {
    "@odata.nextLink": string
}

export type User = {
    id: string                  // 51459127-3fe6-484e-ba9a-ce4b99664097
    userPrincipalName: string   // jbond@gmail.com
    displayName: string         // James Bond
    givenName: string           // James
    surname: string             // Bond
}

export type Event = {
    id: string
    subject: string
    showAs: string
    organizer: Organizer
    attendees: Attendee[]
    start: DateTime
    end: DateTime
    isAllDay: boolean
    isCancelled: boolean
}

export enum ShowAs {
    free = "free",
    busy = "busy"
}

export type Organizer = {
    emailAddress: Email
}

export type Attendee = {
    type: string        // "required",
    emailAddress: Email
}

export type Email = {
    name: string        // "James Bond",
    address: string     // "james.bond@gmail.com"
}

export type DateTime = {
    dateTime: string    // '2020-03-04T00:00:00.0000000'
    timeZone: string    // 'UTC'
}

export function createClient(options: { debug: boolean, baseUrl: string, accessToken: string }) {
    const DEBUG = options.debug
    const BASEURL = options.baseUrl
    const ACCESS_TOKEN = options.accessToken

    return { rest, paged, getUser, getEvents }

    function rest(url: string) {
        DEBUG && console.log("OUTLOOK:REST", url)
        return fetch(url, {
            headers: {
                "Authorization": "Bearer " + ACCESS_TOKEN,
                "Accept": "application/json",
                "Content-Type": "application/json",
                // "Prefer": "outlook.timezone=\"W. Europe Standard Time\""
            }
        }).then(r => r.ok ? r.json() : r.text().then(reason => Promise.reject(`${r.status} ${r.statusText} ${url}\n${reason}`)))
    }

    async function paged<R>(ajax: (q: any) => Promise<Paged>, data: string, options?: any): Promise<R[]> {
        const ans: R[] = []
        let result = await ajax({ ...options, "$top": 999 })
        ans.push(...(result as any)[data])
        while (result["@odata.nextLink"]) {
            result = await rest(result["@odata.nextLink"])
            ans.push(...(result as any)[data])
        }
        return ans
    }

    async function getUser({ search }: { search: string }): Promise<User> {
        const result = await rest(BASEURL + `v1.0/me/people/?$search="${search}"&$select=id,userPrincipalName,displayName,givenName,surname`)
        return result.value.length === 1 ? result.value[0] : Promise.reject("NOT_FOUND")
    }

    function getEvents({ userKey, from, to }: { userKey: string, from: Date, to: Date }, options?: any) {
        return rest(BASEURL + `v1.0/users/${userKey}/calendar/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}${qs(options, "&")}`)
    }
}


function qs(params: any, prefix: string = "?"): string {
    if (typeof params === "object" && params) {
        const ans = Object.keys(params).map(key => {
            let value = params[key]
            if (typeof value === "string") {
                value = value.replace(/\s+/ig, "%20")
            }
            return `${key}=${value}`
        }).join("&")
        if (ans) return prefix + ans
    }
    return ""
}