// form.js - a form for a Schema Markdown struct's value - the Roadie application's road site editor. The form is made
// from the struct's type model, so it has the model's members, and their documentation.

import {escapeHtml} from './format.js';


// Get the kind of a member's form control from its type - "string", "number", "enum", "struct", "strings" (an array
// of strings), or null for a type the form doesn't edit (its value is kept)
function memberKind(types, type) {
    if ('builtin' in type) {
        return {'string': 'string', 'float': 'number', 'int': 'number'}[type.builtin] ?? null;
    } else if ('array' in type) {
        return type.array.type.builtin === 'string' ? 'strings' : null;
    } else if ('user' in type) {
        return ['struct', 'enum'].find((kind) => kind in types[type.user]) ?? null;
    }
    return null;
}


// Get a member's label from its name - "maxGrade" is "Max grade"
function memberLabel(name) {
    const words = name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
    return `${words[0].toUpperCase()}${words.slice(1)}`;
}


// Create a form control's ID from its member's path
function controlId(memberPath) {
    return `roadie-form-${memberPath.replace(/\./g, '-')}`;
}


// Create a form's HTML - the controls of a struct's members, with its value's values. "types" is the type model,
// "typeName" is the struct's name, and "value" is the struct's value. A control's "data-member" attribute is its
// member's path ("start.latitude").
//
// The form is laid out in groups: a struct's controls are a group (a struct's required struct members are groups side
// by side, and an optional struct is a group that's closed unless it has a value), and a group's controls are a grid
// of fields - a field is its label, its control, and its member's documentation. Text and a list of lines (an array
// of strings - a line each) are the grid's full width. A required member's label has a "*", and a member the form
// doesn't edit (an array of structs, say) is only noted, if it has a value.
export function formHtml(types, typeName, value = {}, path = '') {
    const parts = [];
    let fields = [];
    let groups = [];
    const endFields = () => {
        if (fields.length > 0) {
            parts.push(`<div class="roadie-form-fields">\n${fields.join('\n')}\n</div>`);
            fields = [];
        }
    };
    const endGroups = () => {
        if (groups.length > 0) {
            parts.push(`<div class="roadie-form-groups">\n${groups.join('\n')}\n</div>`);
            groups = [];
        }
    };
    for (const {name, type, optional = false, doc = []} of types[typeName].struct.members) {
        const memberValue = value[name] ?? null;
        const kind = memberKind(types, type);
        const memberPath = `${path}${name}`;
        const labelText = `${memberLabel(name)}${optional ? '' : ' *'}`;
        const docText = doc.join(' ');

        // A required struct is a group, beside its neighbors
        if (kind === 'struct' && !optional) {
            endFields();
            groups.push(
                `<fieldset class="roadie-form-group"><legend>${escapeHtml(labelText)}</legend>` +
                    `<div class="roadie-form-doc">${escapeHtml(docText)}</div>\n` +
                    `${formHtml(types, type.user, memberValue ?? {}, `${memberPath}.`)}\n</fieldset>`
            );
            continue;
        }
        endGroups();

        // An optional struct is a group that's closed, unless it has a value
        if (kind === 'struct') {
            endFields();
            parts.push(
                `<details class="roadie-form-group"${memberValue !== null ? ' open' : ''}><summary>${escapeHtml(labelText)} ` +
                    `<span class="roadie-form-doc">${escapeHtml(docText)}</span></summary>\n` +
                    `${formHtml(types, type.user, memberValue ?? {}, `${memberPath}.`)}\n</details>`
            );
            continue;
        }

        // A field - its label, its control, and its documentation
        const id = controlId(memberPath);
        const attrs = `id="${id}" data-member="${memberPath}"`;
        let controlHtml;
        let isWide = true;
        if (kind === 'strings') {
            const text = Array.isArray(memberValue) ? memberValue.join('\n') : '';
            controlHtml = `<textarea ${attrs} rows="5">${escapeHtml(text)}</textarea>`;
        } else if (kind === 'enum') {
            const values = [...(optional ? [''] : []), ...types[type.user].enum.values.map((enumValue) => enumValue.name)];
            const optionsHtml = values.map((enumValue) => (
                `<option${enumValue === memberValue ? ' selected' : ''}>${escapeHtml(enumValue)}</option>`
            ));
            controlHtml = `<select ${attrs}>${optionsHtml.join('')}</select>`;
            isWide = false;
        } else if (kind !== null) {
            const text = memberValue !== null ? `${memberValue}` : '';
            isWide = kind === 'string';
            controlHtml = `<input type="text" ${attrs}${isWide ? '' : ' inputmode="decimal"'} value="${escapeHtml(text)}">`;
        } else if (memberValue !== null) {
            controlHtml = '<p><em>It isn\'t edited here - it\'s kept as it is.</em></p>';
        } else {
            continue;
        }
        const docHtml = escapeHtml(kind === 'strings' ? `${docText} - a line each` : docText);
        fields.push(
            `<div class="roadie-form-field${isWide ? ' roadie-form-wide' : ''}"><label for="${id}">${escapeHtml(labelText)}</label>` +
                `${controlHtml}<div class="roadie-form-doc">${docHtml}</div></div>`
        );
    }
    endFields();
    endGroups();
    return parts.join('\n');
}


// Get a form's value - "element" is the form's element, and "value" is the value the form was made with: its members
// that the form doesn't edit are kept. A control without text has no value - its member is omitted, as is an optional
// struct without members. A number's text that isn't a number is its value, for the model's validation to report.
export function formValue(types, typeName, element, value = {}, path = '') {
    const result = {};
    for (const {name, type, optional = false} of types[typeName].struct.members) {
        const kind = memberKind(types, type);
        const text = (element.querySelector(`[data-member="${path}${name}"]`)?.value ?? '').trim();
        let memberValue = null;
        if (kind === 'struct') {
            memberValue = formValue(types, type.user, element, value[name] ?? {}, `${path}${name}.`);
            memberValue = optional && Object.keys(memberValue).length === 0 ? null : memberValue;
        } else if (kind === 'strings') {
            const strings = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
            memberValue = strings.length > 0 ? strings : null;
        } else if (kind === null) {
            memberValue = value[name] ?? null;
        } else if (text !== '') {
            memberValue = kind === 'number' && !Number.isNaN(Number(text)) ? Number(text) : text;
        }
        if (memberValue !== null) {
            result[name] = memberValue;
        }
    }
    return result;
}


// A point's text - a latitude and a longitude, as a map copies them ("46.16755, -119.16811")
const rePoint = /^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/;


// Paste a point's text into a form's latitude - it's the latitude and its longitude. "element" is the form's element,
// and "event" is its paste event.
export function formPastePoint(element, event) {
    const {member = ''} = event.target.dataset;
    const match = event.clipboardData.getData('text').match(rePoint);
    const longitude = member.endsWith('latitude') ? element.querySelector(`[data-member="${member.slice(0, -8)}longitude"]`) : null;
    if (match !== null && longitude !== null) {
        event.preventDefault();
        [, event.target.value, longitude.value] = match;
    }
}


// Set a form's controls' placeholders - "placeholders" is a member path's placeholder text (a member's default, say;
// "" for none)
export function formPlaceholders(element, placeholders) {
    for (const [memberPath, text] of Object.entries(placeholders)) {
        const control = element.querySelector(`[data-member="${memberPath}"]`);
        if (control !== null) {
            control.placeholder = text !== '' ? `Default: ${text}` : '';
        }
    }
}
