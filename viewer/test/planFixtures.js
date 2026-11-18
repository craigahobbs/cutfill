// planFixtures.js - road plan model test fixtures (the MarkdownUp viewer's test plans) - their tests are in model.test.js


// The simple and complex plans are the view tests' plans
export {complexPlan as planComplex, simplePlan as planSimple} from './viewFixtures.js';


// A road east up a 30% plane, crossing two creeks - its second half follows an existing road
export function planExistingRoad() {
    const rows = [];
    while (rows.length < 5) {
        rows.push([100, 103, 106, 109, 112]);
    }
    return {
        'title': 'Existing Road',
        'units': 'feet',
        'topography': {
            'spacing': 10,
            'elevations': rows,
            'features': [
                {'type': 'stream', 'name': 'West Creek', 'points': [{'x': 10, 'y': 0}, {'x': 10, 'y': 40}]},
                {'type': 'stream', 'name': 'East Creek', 'points': [{'x': 30, 'y': 0}, {'x': 30, 'y': 40}]}
            ]
        },
        'start': {'x': 0, 'y': 20},
        'end': {'x': 40, 'y': 20},
        'options': [
            {
                'name': 'Join',
                'section': {'width': 10},
                'alignment': [{'x': 0, 'y': 20}, {'x': 20, 'y': 20}, {'x': 30, 'y': 20}, {'x': 40, 'y': 20, 'z': 150}],
                'structures': [{'type': 'existingRoad', 'station': 20, 'endStation': 40}]
            }
        ]
    };
}
