import * as ts from "./date"
import * as R from 'ramda'

export const Hours = Object.freeze({
    Working: 8,
    Lunch: 1,
    Interrupts: 2
})

export type Period = { from: Date, to: Date }
export type Ticket = { ticket: string } & Period
export type Meeting = { meeting: string } & Period

export async function compute({ debug, tickets, meetings, computeDays }: { debug: boolean, tickets: Ticket[], meetings: Meeting[], computeDays: number }) {
    debug && console.group("\nCOMPUTE TIMESHEET:")

    const since = ts.addDays(-(computeDays-1), ts.date(ts.now()))

    const ticketz = prepare(tickets, { since })
    debug && console.info("TICKETS:")
    debug && console.dir(ticketz)

    const meetingz = prepare(meetings, { since })
    debug && console.info("MEETINGS:")
    debug && console.dir(meetingz)

    const today: ts.Interval = { from: ts.workAt(ts.now()), to: ts.addHours(Hours.Working + Hours.Lunch, ts.workAt(ts.now())) }
    const timesheet: any[] = []
    for (let day = 0; day < computeDays; day++) {
         const date: ts.Interval = { from: ts.addDays(-day, today.from), to: ts.addDays(-day, today.to) }
         if (ts.isWorkingDay(date.from)) {
            const tasks: any[] = []
            const key = toISO(date.from, 10)
            const includes = ticketz[key] || []
            const excludes = meetingz[key] || []
            console.log("date", key)
            console.log("includes", includes)
            console.log("excludes", excludes)
            for (const ticket of includes) {
                // small ticket within 1 day
                if (ts.date(date.from) === ts.date(ticket.from) && ts.date(ticket.from) === ts.date(ticket.to)) {
                    tasks.push({
                        ticket: ticket.ticket,
                        include: duration(ticket),
                        from: ticket.from,
                        to: ticket.to,
                    })
                    continue
                }
                // long ticket and intersection between days
                const interval = ts.intersect(ticket, date)
                if (interval !== null) {
                    tasks.push({
                        include: {
                            ticket: ticket.ticket,
                            duration: duration(interval),
                            from: interval.from,
                            to: interval.to
                        },
                        exclude: {

                        }
                    })
                    continue
                }
            }
            // TODO: warn task overlaps and exclude
            console.log(`${key} tasks`, tasks)
    //         if (tasks.length > 0) {
    //             const include = limit(round(tasks.reduce((a, e) => a + e.duration, 0)))
    //             const maxWorkingHours = Hours.Working - Hours.Interrupts
    //             const exclude = Math.max(0, include - maxWorkingHours)
    //             const total = include - exclude
    //             timesheet.push({ date: date.from, total, include, exclude, tasks })
    //         }
        }
    }

    debug && console.groupEnd()
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


export function prepare<T extends Period>(list: T[], { since }: { since: Date }): { [key: string]: T[] } {
    const removeOutdated = R.filter<T, "array">(it => it.to.getTime() >= since.getTime())
    const limitPeriod = R.map<T, T>(it => it.from.getTime() >= since.getTime() ? it : { ...it, from: since })
    const sortAsc: (list: readonly T[]) => T[] = R.sortBy((it: T) => it.from.getTime())
    const groupByDate = R.groupBy((it: T) => toISO(it.from, 10))
    const result = R.pipe(removeOutdated, limitPeriod, R.map(splitByDate), R.flatten, sortAsc, groupByDate)(list)
    return result
}

function toISO(date: Date, number: 10) {
    return ts.date(date).toISOString().substr(0, number)
}

export function splitByDate<T extends Period>(a: T): T[] {
    const result: T[] = []
    const start = ts.date(a.from)
    const end = ts.date(a.to)
    if (start.getTime() === end.getTime()) {
        result.push(a)
    } else {
        const r = { ...a }
        r.from = ts.date(r.to)
        let l = { ...a }
        l.to = ts.addSecond(-1, ts.addDays(1, ts.date(l.from)))
        result.push(l)
        l = { ...l, from: ts.addDays(1, ts.date(l.from)), to: ts.addDays(1, l.to) }
        while (l.to < r.from) {
            result.push(l)
            l = { ...l, from: ts.addDays(1, l.from), to: ts.addDays(1, l.to) }
        }
        result.push(r)
    }
    return result
}
