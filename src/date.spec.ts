import * as assert from 'assert'
import * as ts from "./date"

describe("date", () => {
    describe("parse", () => {
        it("should parse UTC", () => {
            // arrange
            const expected = "2020-03-02T14:15:12.345Z"

            // act
            const actual = ts.parse(expected).toISOString()

            // assert
            assert.equal(actual, expected)
        })
    })

    describe("date", () => {
        for (let hour = 0; hour < 24; ++hour) {
            it(`should return date: ${('0' + hour).substr(-2)}h`, () => {
                // arrange
                const expected = "2020-03-02T00:00:00.000Z"

                // act
                const actual = ts.date(ts.parse(`2020-03-02T${("0" + hour).substr(-2)}:15:12.345Z`)).toISOString()

                // assert
                assert.equal(actual, expected)
            })
        }
    })

    describe("addDays", () => {
        [
            { time: "2020-03-02T00:00:00.000Z", days: 1, expected: "2020-03-03T00:00:00.000Z" },
            { time: "2020-03-02T00:00:00.000Z", days: 2, expected: "2020-03-04T00:00:00.000Z" },
            { time: "2020-03-02T23:59:59.999Z", days: 1, expected: "2020-03-03T23:59:59.999Z" },
            { time: "2020-03-02T23:59:59.999Z", days: 2, expected: "2020-03-04T23:59:59.999Z" },
            { time: "2020-03-15T13:30:45.678Z", days: 3, expected: "2020-03-18T13:30:45.678Z" },
        ].forEach(given => {
            it(`should add the ${given.days} day(s) to the ${given.time}`, () => {
                // arrange
                const { expected } = given

                // act
                const actual = ts.addDays(given.days, ts.parse(given.time)).toISOString()

                // assert
                assert.equal(actual, expected)
            })
        })
    })

    describe("intersect", () => {
        it("should return nothing if not intersected", () => {
            // arrange
            const expected = null

            // act
            const actual = ts.intersect(
                { from: new Date("2020-02-01T12:00:00.000Z"), to: new Date("2020-02-01T23:59:59.000Z") },
                { from: new Date("2020-03-01T12:00:00.000Z"), to: new Date("2020-03-01T23:59:59.000Z") }
            )

            // assert
            assert.equal(actual, expected)
        })

        it("should return an intersection if partially intersected", () => {
            // arrange
            const expected = { from: new Date("2020-03-01T12:00:00.000Z"), to: new Date("2020-03-01T23:59:59.000Z") }

            // act
            const actual = ts.intersect(
                { from: new Date("2020-02-01T12:00:00.000Z"), to: new Date("2020-03-01T23:59:59.000Z") },
                { from: new Date("2020-03-01T12:00:00.000Z"), to: new Date("2020-04-01T23:59:59.000Z") }
            )

            // assert
            assert.deepEqual(actual, expected)
        })

        it("should return the same if fully intersected", () => {
            // arrange
            const expected = { from: new Date("2020-02-01T12:00:00.000Z"), to: new Date("2020-03-01T23:59:59.000Z") }

            // act
            const actual = ts.intersect(expected, expected)

            // assert
            assert.deepEqual(actual, expected)
        })
    })
})