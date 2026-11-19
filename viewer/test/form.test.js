import {formHtml, formPastePoint, formValue} from '../lib/form.js';
import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import {parseSchemaMarkdown} from 'schema-markdown/lib/parser.js';
import test from 'node:test';


// The test's type model - a struct with a member of each kind
const types = parseSchemaMarkdown([
    'struct Trip',
    '',
    '    # The trip\'s name -',
    '    # its <title>',
    '    string tripName',
    '    optional int days',
    '    float cost',
    '    Mode mode',
    '    optional Mode returnMode',
    '    Place start',
    '    optional Place end',
    '    optional Place alternate',
    '    optional string[] notes',
    '    optional Place[] stops',
    '    optional bool paid',
    '    optional string{} tags',
    '    optional Miles distance',
    '    Place destination',
    '',
    'enum Mode',
    '    car',
    '    train',
    '',
    'struct Place',
    '    optional string city',
    '    optional float latitude',
    '    optional float longitude',
    '',
    'typedef float(> 0) Miles'
]);


// Create a form's element of a value
function formElement(value) {
    const {window} = new JSDOM(`<!DOCTYPE html><form>${value !== null ? formHtml(types, 'Trip', value) : formHtml(types, 'Trip')}</form>`);
    return window.document.querySelector('form');
}


test('formHtml', () => {
    // A form's controls are its struct's members', with its value's values
    const value = {
        'tripName': 'North & "south"', 'days': 3, 'cost': 12.5, 'mode': 'train', 'start': {'city': 'Pasco', 'latitude': 46.2},
        'alternate': {}, 'notes': ['Pack <light>.', 'Leave early.'], 'stops': [{'city': 'Yakima'}], 'paid': true, 'distance': 80,
        'destination': {'city': 'Ritzville'}
    };
    const form = formElement(value);
    const controls = [...form.querySelectorAll('[data-member]')];
    assert.deepEqual(controls.map((control) => [control.dataset.member, control.tagName, control.value]), [
        ['tripName', 'INPUT', 'North & "south"'], ['days', 'INPUT', '3'], ['cost', 'INPUT', '12.5'], ['mode', 'SELECT', 'train'],
        ['returnMode', 'SELECT', ''],
        ['start.city', 'INPUT', 'Pasco'], ['start.latitude', 'INPUT', '46.2'], ['start.longitude', 'INPUT', ''],
        ['end.city', 'INPUT', ''], ['end.latitude', 'INPUT', ''], ['end.longitude', 'INPUT', ''],
        ['alternate.city', 'INPUT', ''], ['alternate.latitude', 'INPUT', ''], ['alternate.longitude', 'INPUT', ''],
        ['notes', 'TEXTAREA', 'Pack <light>.\nLeave early.'],
        ['destination.city', 'INPUT', 'Ritzville'], ['destination.latitude', 'INPUT', ''], ['destination.longitude', 'INPUT', '']
    ]);

    // The form's layout - grids of fields, and groups of a struct's fields
    assert.deepEqual([...form.children].map((element) => (
        `${element.tagName} ${element.className} ${[...element.children].map((child) => child.className || child.tagName).join(',')}`
    )), [
        'DIV cutfill-form-fields cutfill-form-field cutfill-form-wide,cutfill-form-field,cutfill-form-field,cutfill-form-field,' +
            'cutfill-form-field',
        'DIV cutfill-form-groups cutfill-form-group',
        'DETAILS cutfill-form-group SUMMARY,cutfill-form-fields',
        'DETAILS cutfill-form-group SUMMARY,cutfill-form-fields',
        'DIV cutfill-form-fields cutfill-form-field cutfill-form-wide,cutfill-form-field cutfill-form-wide,' +
            'cutfill-form-field cutfill-form-wide,' +
            'cutfill-form-field cutfill-form-wide',
        'DIV cutfill-form-groups cutfill-form-group'
    ]);

    // A field is its member's label - its name's words, and a "*" if it's required - its control, and its documentation
    assert.equal(
        form.querySelector('.cutfill-form-field').outerHTML,
        '<div class="cutfill-form-field cutfill-form-wide"><label for="cutfill-form-tripName">Trip name *</label>' +
            '<input type="text" id="cutfill-form-tripName" data-member="tripName" value="North &amp; &quot;south&quot;">' +
            '<div class="cutfill-form-doc">The trip\'s name - its &lt;title&gt;</div></div>'
    );
    assert.deepEqual([...form.querySelectorAll('label')].slice(0, 6).map((label) => label.textContent), [
        'Trip name *', 'Days', 'Cost *', 'Mode *', 'Return mode', 'City'
    ]);
    assert.equal(form.querySelector('[data-member="days"]').getAttribute('inputmode'), 'decimal');
    assert.equal(form.querySelector('[data-member="start.city"]').id, 'cutfill-form-start-city');
    assert.equal(form.querySelector('label[for="cutfill-form-notes"]').nextElementSibling.nextElementSibling.textContent, ' - a line each');

    // An enumeration's values - an optional one's may be none
    assert.deepEqual(['mode', 'returnMode'].map((member) => (
        [...form.querySelector(`[data-member="${member}"]`).options].map((option) => option.textContent)
    )), [['car', 'train'], ['', 'car', 'train']]);

    // A required struct is a group of its members' fields - an optional struct's is closed, unless it has a value
    assert.deepEqual([...form.querySelectorAll('fieldset > legend')].map((legend) => legend.textContent), ['Start *', 'Destination *']);
    assert.equal(form.querySelectorAll('fieldset')[0].querySelectorAll('[data-member]').length, 3);
    assert.deepEqual([...form.querySelectorAll('details')].map((details) => [details.querySelector('summary').textContent, details.open]), [
        ['End ', false], ['Alternate ', true]
    ]);

    // The members that aren't edited are noted, if they have values
    assert.deepEqual([...form.querySelectorAll('em')].map((note) => note.closest('.cutfill-form-field').textContent), [
        'StopsIt isn\'t edited here - it\'s kept as it is.',
        'PaidIt isn\'t edited here - it\'s kept as it is.',
        'DistanceIt isn\'t edited here - it\'s kept as it is.'
    ]);

    // A form without a value, and one whose value's members aren't its model's
    const texts = (element) => [...element.querySelectorAll('[data-member]')].map((control) => control.value).filter((text) => text !== '');
    assert.deepEqual(texts(formElement(null)), ['car']);
    const invalid = formElement({'tripName': 5, 'mode': 'bus', 'start': 'Pasco', 'notes': 'Pack light.', 'cost': null});
    assert.deepEqual(texts(invalid), ['5', 'car']);
});


test('formValue', () => {
    // A form's value is its controls' - the members that aren't edited are the value's that the form was made with
    const value = {
        'tripName': 'North', 'days': 3, 'cost': 12.5, 'mode': 'train', 'start': {'city': 'Pasco', 'latitude': 46.2},
        'alternate': {}, 'notes': ['Pack light.', 'Leave early.'], 'stops': [{'city': 'Yakima'}], 'paid': true, 'tags': {'kind': 'work'},
        'destination': {'city': 'Ritzville'}
    };
    const form = formElement(value);
    const {alternate, ...expected} = value;
    assert.deepEqual(alternate, {});
    assert.deepEqual(formValue(types, 'Trip', form, value), expected);

    // Edit the form - a control without text has no value, and a number that isn't one is its text
    for (const [member, text] of [
        ['tripName', '  South  '], ['days', ''], ['cost', '1e2'], ['mode', 'car'], ['returnMode', 'train'], ['start.city', ' '],
        ['start.longitude', '-119.1'], ['end.latitude', 'north'], ['notes', '\n  Pack heavy.  \n\n']
    ]) {
        form.querySelector(`[data-member="${member}"]`).value = text;
    }
    assert.deepEqual(formValue(types, 'Trip', form, value), {
        'tripName': 'South', 'cost': 100, 'mode': 'car', 'returnMode': 'train', 'start': {'latitude': 46.2, 'longitude': -119.1},
        'end': {'latitude': 'north'}, 'notes': ['Pack heavy.'], 'stops': [{'city': 'Yakima'}], 'paid': true, 'tags': {'kind': 'work'},
        'destination': {'city': 'Ritzville'}
    });

    // A form without a value - a required struct is its value, though it has no members
    form.querySelector('[data-member="notes"]').value = '';
    form.querySelector('[data-member="start.latitude"]').value = '';
    form.querySelector('[data-member="start.longitude"]').value = '';
    form.querySelector('[data-member="destination.city"]').value = '';
    assert.deepEqual(formValue(types, 'Trip', form), {
        'tripName': 'South', 'cost': 100, 'mode': 'car', 'returnMode': 'train', 'start': {}, 'end': {'latitude': 'north'}, 'destination': {}
    });
});


test('formPastePoint', () => {
    // A point's text that's pasted into a latitude is the latitude and its longitude
    const form = formElement({});
    const paste = (member, text) => {
        const event = {
            'target': member !== null ? form.querySelector(`[data-member="${member}"]`) : form,
            'clipboardData': {'getData': (format) => (format === 'text' ? text : null)},
            'prevented': false,
            'preventDefault': () => {
                event.prevented = true;
            }
        };
        formPastePoint(form, event);
        return event.prevented;
    };
    const values = () => ['start.latitude', 'start.longitude', 'end.latitude', 'end.longitude', 'tripName'].map((member) => (
        form.querySelector(`[data-member="${member}"]`).value
    ));
    assert.equal(paste('start.latitude', '46.16755, -119.16811'), true);
    assert.deepEqual(values(), ['46.16755', '-119.16811', '', '', '']);
    assert.equal(paste('end.latitude', '  ( -46 ,119 )\n'), true);
    assert.deepEqual(values(), ['46.16755', '-119.16811', '-46', '119', '']);

    // Other text, and other controls, are pasted as they are
    for (const [member, text] of [
        ['start.latitude', '46.2'], ['start.latitude', '46.2, north'], ['start.latitude', '1, 2, 3'], ['start.longitude', '1, 2'],
        ['tripName', '1, 2'], [null, '1, 2']
    ]) {
        assert.equal(paste(member, text), false, `${member} ${text}`);
    }
    assert.deepEqual(values(), ['46.16755', '-119.16811', '-46', '119', '']);
});
