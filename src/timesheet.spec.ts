import * as assert from 'assert'
import * as T from "./timesheet"

describe("timesheet", () => {
    describe("split", () => {
        it("should replicate the data", () => {
            // arrange
            const given = { expected: Date.now() }

            // act
            const actual = T.splitByDate({
                ...given,
                from: new Date("2020-03-02T14:15:00Z"),
                to: new Date("2020-03-04T10:45:00Z")
            })

            // assert
            assert.equal(actual.length, 3)
            actual.forEach(it => assert.equal(it.expected, given.expected))
        })

        it("should return the same object within 1 day", () => {
            // arrange
            const expected = { from: new Date("2020-03-02T14:15:00.000Z"), to: new Date("2020-03-02T23:59:59.000Z") }

            // act
            const actual = T.splitByDate(expected)

            // assert
            assert.equal(actual.length, 1)
            actual.forEach((_, i) => assert.equal(actual[i], expected))
        })

        it("should split the period by days", () => {
            // arrange
            const expected = [
                { from: new Date("2020-03-02T14:15:00.000Z"), to: new Date("2020-03-02T23:59:59.000Z") },
                { from: new Date("2020-03-03T00:00:00.000Z"), to: new Date("2020-03-03T23:59:59.000Z") },
                { from: new Date("2020-03-04T00:00:00.000Z"), to: new Date("2020-03-04T10:45:00.000Z") },
            ]

            // act
            const actual = T.splitByDate(
                { from: new Date("2020-03-02T14:15:00.000Z"), to: new Date("2020-03-04T10:45:00.000Z") }
            )

            // assert
            assert.equal(actual.length, 3)
            actual.forEach((_, i) => {
                assert.deepEqual(actual[i], expected[i])
            })
        })
    })
})