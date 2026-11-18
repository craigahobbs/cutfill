// util.js - a web browser's "node:util" - the planning tools' commands parse their arguments with its parseArgs. The
// Roadie application's page maps "node:util" to this module (its import map).


// Parse a command's arguments - "args" are the arguments, "options" are the command's options (an option's "type" is
// "string" or "boolean", and it may have a "short" name, be "multiple", and have a "default"), and positional
// arguments are allowed with "allowPositionals". Returns the options' "values" and the "positionals". As Node's does,
// it throws an error for an unknown option, an option without its value (or with a value it doesn't take), and a
// positional argument that isn't allowed.
export function parseArgs({args, options = {}, allowPositionals = false}) {
    const values = Object.create(null);
    const positionals = [];
    const optionNames = Object.keys(options);
    for (let ixArg = 0; ixArg < args.length; ixArg++) {
        const arg = args[ixArg];

        // The arguments after "--" are positional
        if (arg === '--') {
            positionals.push(...args.slice(ixArg + 1));
            break;
        }

        // A positional argument?
        if (!arg.startsWith('-') || arg.length === 1) {
            positionals.push(arg);
            continue;
        }

        // The option's name, and its value if it's a part of the argument ("--name=value", or "-nvalue")
        const isLong = arg.startsWith('--');
        const ixValue = isLong ? arg.indexOf('=') : (arg.length > 2 ? 2 : -1);
        const argName = isLong ? arg.slice(2, ixValue === -1 ? arg.length : ixValue) : arg[1];
        const name = optionNames.find((optionName) => (isLong ? optionName : options[optionName].short) === argName) ?? null;
        let value = ixValue === -1 ? null : arg.slice(ixValue + (isLong ? 1 : 0));
        if (name === null) {
            throw new TypeError(`Unknown option '${arg}'`);
        }

        // A boolean option has no value - a string option's is the next argument, if it isn't a part of this one
        const option = options[name];
        if (option.type === 'boolean') {
            if (value !== null) {
                throw new TypeError(`Option '${arg}' does not take an argument`);
            }
            value = true;
        } else if (value === null) {
            ixArg += 1;
            value = args[ixArg] ?? null;
            if (value === null || (value.startsWith('-') && value.length > 1)) {
                throw new TypeError(`Option '${arg}' argument missing`);
            }
        }
        if (option.multiple ?? false) {
            values[name] ??= [];
            values[name].push(value);
        } else {
            values[name] = value;
        }
    }
    if (!allowPositionals && positionals.length > 0) {
        throw new TypeError(`Unexpected argument '${positionals[0]}'`);
    }

    // The options' defaults
    for (const name of optionNames) {
        if (!(name in values) && 'default' in options[name]) {
            values[name] = options[name].default;
        }
    }
    return {values, positionals};
}
