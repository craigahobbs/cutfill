import {describeCommand, keepCommand} from '../lib/options.js';
import assert from 'node:assert/strict';
import {fixturePlan} from '../../viewer/test/fixture.js';
import {planText} from '../../viewer/lib/model.js';
import test from 'node:test';
import {testIo} from './terrainHelpers.js';


// Run a command on the fixture plan ("road.json" - its options are "Direct" and "Bridge - East") and the descriptions
// file ("descriptions.md") - returns its exit code, its output, and the written plan (null if it wasn't written) - or
// null, if its arguments are invalid
function run(command, args, {plan = fixturePlan(), descriptions = null} = {}) {
    const files = {'road.json': typeof plan === 'string' ? plan : JSON.stringify(plan)};
    if (descriptions !== null) {
        files['descriptions.md'] = descriptions;
    }
    const io = testIo({files});
    const result = {'describe': describeCommand, 'keep': keepCommand}[command](['road.json', ...args], io);
    if (result === null) {
        return null;
    }
    const written = io.written.includes('road.json') ? io.files['road.json'] : null;
    return {'code': result.code, 'output': `${result.lines.join('\n')}\n`, written, 'plan': written !== null ? JSON.parse(written) : null};
}


test('describe', () => {
    // The plan's and an option's descriptions - without the blank lines around them. The other option's is kept.
    const {code, output, written, plan} = run('describe', ['descriptions.md'], {'descriptions': `

# Plan

A road to the house.

- Gravel

# Option: Bridge - East\r
Over the creek.  \r
`});
    assert.deepEqual([code, output], [0, `\
The plan's description: 3 lines
Option "Bridge - East"'s description: 1 line
Wrote road.json
`]);
    assert.deepEqual(plan.description, ['A road to the house.', '', '- Gravel']);
    assert.deepEqual(plan.options.map((option) => option.description), [fixturePlan().options[0].description, ['Over the creek.']]);

    // The plan is written as the plan file's text - nothing else is changed
    assert.equal(written, planText(plan));
    const expected = fixturePlan();
    expected.description = plan.description;
    expected.options[1].description = ['Over the creek.'];
    assert.deepEqual(plan, expected);
});


test('describe, a strikethrough', () => {
    // The viewer's Markdown renders "~...~" as strikethrough
    const {code, output, plan} = run('describe', ['descriptions.md'], {'descriptions': '# Option:  Direct \n~100 feet of road\n'});
    assert.deepEqual([code, output], [0, `\
Option "Direct"'s description: 1 line
WARNING: Option "Direct"'s description has a "~" - the viewer's Markdown renders "~...~" as strikethrough
Wrote road.json
`]);
    assert.deepEqual(plan.options[0].description, ['~100 feet of road']);
});


test('describe, invalid descriptions', () => {
    for (const [descriptions, message] of [
        ['# Option: North\nA road.\n', 'error: no option named "North" (the plan\'s options are "Direct", "Bridge - East")'],
        ['# Plan\n\n# Option: Direct\nA road.\n', 'error: The plan\'s description has no text'],
        ['# Plan\nA road.\n# Option: Direct\n \n', 'error: Option "Direct"\'s description has no text'],
        [
            'A road.\n# Plan\nA road.\n',
            'error: The descriptions "descriptions.md" don\'t start with a "# Plan" or "# Option: NAME" heading'
        ],
        ['\n\n', 'error: The descriptions "descriptions.md" have no "# Plan" or "# Option: NAME" heading'],
        [null, 'error: Could not load the descriptions "descriptions.md"']
    ]) {
        assert.deepEqual(run('describe', ['descriptions.md'], {descriptions}), {
            'code': 1, 'output': `${message}\n`, 'written': null, 'plan': null
        });
    }

    // The plan can't be loaded
    assert.deepEqual(run('describe', ['descriptions.md'], {'plan': 'Not JSON', 'descriptions': '# Plan\nA road.\n'}), {
        'code': 1, 'output': 'error: Could not load the road plan "road.json"\n', 'written': null, 'plan': null
    });

    // Invalid arguments
    for (const args of [[], ['descriptions.md', 'extra.md'], ['--file']]) {
        assert.equal(run('describe', args), null);
    }
    assert.equal(describeCommand(['--plan', 'descriptions.md'], testIo()), null);
});


test('keep', () => {
    // The options are kept in cost score order - the fixture plan's, the other way around
    const reversed = fixturePlan();
    reversed.options.reverse();
    const {code, output, written, plan} = run('keep', ['Bridge - East', 'Direct'], {'plan': reversed});
    assert.deepEqual([code, output], [0, `\
Option 0: "Direct" - cost score 48.6, design warnings: 1
Option 1: "Bridge - East" - cost score 390.2, design warnings: 1
Wrote road.json
`]);
    assert.equal(written, planText(plan));
    assert.deepEqual(plan, fixturePlan());

    // An option that isn't named is removed
    const one = run('keep', ['Bridge - East']);
    assert.deepEqual([one.code, one.output], [0, `\
Option 0: "Bridge - East" - cost score 390.2, design warnings: 1
Removed: "Direct"
Wrote road.json
`]);
    assert.deepEqual(one.plan, {...fixturePlan(), 'options': [fixturePlan().options[1]]});
});


test('keep, invalid arguments', () => {
    assert.deepEqual(run('keep', ['Direct', 'North']), {
        'code': 1,
        'output': 'error: no option named "North" (the plan\'s options are "Direct", "Bridge - East")\n',
        'written': null,
        'plan': null
    });

    // A site's plan has no options yet
    assert.deepEqual(run('keep', ['Direct'], {'plan': {...fixturePlan(), 'options': []}}), {
        'code': 1, 'output': 'error: no option named "Direct" (the plan\'s options are none)\n', 'written': null, 'plan': null
    });

    // The plan can't be loaded
    assert.deepEqual(run('keep', ['Direct'], {'plan': 'Not JSON'}), {
        'code': 1, 'output': 'error: Could not load the road plan "road.json"\n', 'written': null, 'plan': null
    });

    // Invalid arguments
    for (const args of [[], ['--all'], ['Direct', '-x']]) {
        assert.equal(run('keep', args), null);
    }
    assert.equal(keepCommand([], testIo()), null);
});
