# Roadie Planning Tools

The Roadie road planning tools - the command line tools that a road planning session (`make plan`) engineers a road
with - and the road planning instructions, [PLAN.md](PLAN.md). The tools are JavaScript (ES modules in `lib/`) built
with [javascript-build](https://github.com/craigahobbs/javascript-build#readme), and they use the
[Roadie viewer](../viewer/README.md)'s road plan model. See the project's [README](../README.md).

```sh
node bin/plan.js site <site.json> <plan.json>    # create a plan's site from a road site model - its lidar terrain
node bin/plan.js plot <plan.json> <plot.png>     # plot a plan - its terrain, features, and options
node bin/plan.js locate <plan.json> <lat,long>   # a latitude and longitude's plan coordinates (--xy: the reverse)
node bin/plan.js feature <plan.json> TYPE X,Y... # add a topographic feature (--remove NAME: remove a name's)
node bin/plan.js draws <plan.json>               # the terrain's unmapped draws (--add NUMBER: add one as a stream)
node bin/plan.js options <plan.json>             # engineer the plan's standard options, in cost score order
node bin/plan.js route <plan.json> -n NAME       # engineer a road option - its alignment, profile, and structures
node bin/plan.js profile <plan.json> -n NAME     # re-design an option's profile and structures
node bin/plan.js evaluate <plan.json>            # a plan's analysis and cost (the viewer's)
node bin/plan.js keep <plan.json> NAME...        # keep the named options, in cost score order
node bin/plan.js draft <plan.json> <text.md>     # write a draft of the descriptions - the plan's and options' facts
node bin/plan.js describe <plan.json> <text.md>  # set the plan's and its options' descriptions
node bin/plan.js doc [site | plan]               # the road site model's documentation - or the road plan model's
```

`make plan FILE=<plan>.site.json` and `make update FILE=<plan.json>` launch a planning session (Claude Code) that
follows [PLAN.md](PLAN.md) with these tools, `make auto FILE=<plan>.site.json` engineers a site's standard options
with the tools alone (`site`, `options`, `draft`, `describe`, and `plot`), and `make evaluate FILE=<plan.json>` prints
a plan's analysis and cost (`evaluate`, the viewer's). Every command has a `-h` argument.

The tools do the plan's engineering and its file's edits, so that a planning session's result doesn't depend on the
code its model writes - or on how capable its model is. The session does what the tools can't: it applies the site's
notes, checks the site against its plots, chooses any other corridors to compare, and explains the result - and
PLAN.md's steps are defined actions (what to look at, what to decide, and the command to run). The tools do the rest:
they find each corridor's least-cost road, report its cost score, draft the descriptions' facts, write the plan, and
log the commands that changed it (`<plan>.work/commands.txt`).

A road site model (`<name>.site.json`) is a road's start and end points, as latitudes and longitudes, and its
planning instructions. `site` finds the USGS 3D Elevation Program's 1 meter elevation models of the site (lidar
ground elevations), reads the site's part of them (it's cached in the plan's work directory,
`<plan>.work/terrain/`), and grids them in the plan's coordinates - a transverse Mercator projection centered on
the site. The newest survey's elevations are used, and an older survey's where the newer have none. The site's
features are the USGS National Map's streams, roads, and trails, and the site's exclusion areas, and its
topographic map image (`<plan>.png`) is the National Map's. The streams were mapped at a coarser scale than the
terrain, so each is moved to the bottom of its valley - the lowest ground within 30 meters across it. The roads (the
National Map's highways, local roads, and four-wheel-drive roads) are existing roads that a road option may follow -
its trails are for reference. `site` on an existing plan creates its site again (a larger site, a finer grid): the
plan's options are kept, and its features that aren't the site's - its rock outcrops, its other exclusion areas,
and the features that `feature` and `draws` added (the model's `added` features) - in the new grid's coordinates.

`plot` draws a plan for the planning session to study: its terrain, shaded (lit from the northwest) with contours,
its features, each option's line with its stations and structures, and the plan's coordinates along its sides.
`--box X1,Y1,X2,Y2` plots a part of the plan, for a closer look - with the contour interval of its elevations.

`draws` finds the site's draws - the valleys of its terrain that carry water in a storm, which a road crosses with a
culvert (`lib/draws.js`). The terrain's hollows are filled (a road's fill across a valley is one - its culvert isn't
in the terrain), each grid point drains to its steepest neighbor below it, and a draw is the line of points that drain
at least an area - 3 acres (1.2 hectares) by default. The draws that aren't along the plan's streams are listed,
and `--add NUMBER` adds one as a stream. A draw's area is the site's ground that drains to it.

`options` engineers a plan's standard options - `route`'s road ("Existing Roads", if it follows any of the plan's
existing roads) and `route --all-new`'s ("New Road") - and puts the plan's options in cost score order. The options
of those names are replaced, so it's run again after the plan's features or criteria change.

`route` searches for the least-cost horizontal alignment on a lattice with heading states (so its turns have the
minimum radius), designs the vertical profile by dynamic programming (the minimum earthwork cost within the grade
limits, within the maximum cut and fill depth of the ground), and places the structures (`lib/route.js`,
`lib/profile.js`, `lib/structures.js`). The search's penalty for ground that's steeper than the design grade stands
in for the earthwork a road needs there - it isn't a cost, so no one weight of it is right. A route is searched with
three weights (1, 0.5, and 0.25), each search's road is designed, and the route's road is the one with the lowest
cost score - it's never worse than the first weight's road, by its cost score or its design warnings
(`--grade-weight` searches with one weight). It's a port of the project's first planning tools, which were Python (they
digitized a topographic map image) - their results are the engineering tests' expectations
(`test/expected/pythonTools.json`).

The route search follows the plan's existing roads (its `road` features, `lib/roads.js`) where that costs less than
a new road: a move along an existing road costs its length's upgrade, with no earthwork, grade limit, or culvert,
and it turns as the road does. The route's runs along existing roads are the roads' lines and the option's
`existingRoad` structures - from the minimum radius after the route joins a road to the minimum radius before it
leaves it, so a junction's curve is new road. `--all-new` searches for an all-new road.

A road is within its grade limit. Where a route's profile can't be - at the design grade, it can't reach the end
point's ground, or an existing road's - `route` searches again with stricter grades, and if there's still no road,
it's an error and no option is written. `profile` fails the same way on an alignment that's too steep.

`route` and `profile` report the option's existing roads (and their grades as they're built, which aren't designed),
structure counts, cost score, and design warning count - and note a road within its minimum radius of the site's edge
(the site may be too small for the best route). `route` notes a via point that the road turns back at: the straight
line between the road's points 10 minimum radii before and after the via point is less than half their distance
along the road. Both note the unmapped draws that the road crosses (`draws`' draws of the default area) - a
draw that isn't a stream of the plan has no culvert there.

`draft` writes a draft of the plan's descriptions (`lib/draft.js`) - the Markdown file that `describe` sets, with the
facts the tools know: the site's points and criteria, the features that were added, and each option's length, grades,
existing roads (and their grades as they're built), structures, earthwork, largest cost items, and design warnings.
A planning session adds what the tools don't know - the road's purpose, its corridors, and what to verify.
