export function parse(text: string): Date {
    return new Date(Date.parse(text))
}

export function now(): Date {
    return new Date(Date.now())
}

export function today(): Date {
    const ts = now()
    return new Date(Date.UTC(ts.getFullYear(), ts.getMonth(), ts.getDate(), 8, 30, 0, 0)) // 8:30am
}

export function date(ts: Date): Date {
    return new Date(Date.UTC(ts.getFullYear(), ts.getMonth(), ts.getDate(), 0, 0, 0, 0))
}

export function addDays(days: number, ts: Date): Date {
    return new Date(ts.getTime() + days * 86400000)
}

export function addHours(hours: number, ts: Date): Date {
    return new Date(ts.getTime() + hours * 3600000)
}

export function addSecond(seconds: number, ts: Date): Date {
    return new Date(ts.getTime() + seconds * 1000)
}

export function isWorkingDay(ts: Date) {
    return 1 <= ts.getDay() && ts.getDay() <= 5
}

export type Interval = { from: Date, to: Date }
export function intersect(a: Interval, b: Interval): Interval | undefined {
    if (a.from <= b.to && b.from <= a.to) {
        return {
            from: new Date(Math.max(a.from.getTime(), b.from.getTime())),
            to: new Date(Math.min(a.to.getTime(), b.to.getTime()))
        }
    }
}

export class Intervals {
    constructor(intervals: Interval[]) {
        Array.from(intervals).sort((a, b) => b.from.getTime() - a.from.getTime())
    }
}