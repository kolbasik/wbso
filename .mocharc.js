// https://github.com/mochajs/mocha/tree/master/example/config

module.exports = {
    recursive: true,
    forbidOnly: true,
    checkLeaks: true,
    fullTrace: true,
    diff: true,
    inlineDiffs: true,
    extension: ['ts','tsx'],
    file: ['mocha.setup.js']
}