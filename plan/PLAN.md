# Roadie Road Planning Instructions

You are planning a low-volume road (a driveway, a rural access road, or a forest road) from a start
point to an end point, and writing it as a Roadie **road plan model** JSON file. The Roadie viewer
(the Roadie application - `make run`, then open the plan) renders the model in 3D, and its cost score
compares the plan's options.

**The planning tools do the engineering.** They build the site from the USGS's lidar terrain, find
and design the roads, cost them, and draft their descriptions. Your job is what the tools can't do:

- apply the user's notes,
- check the site against what you can see on its plots,
- choose any other corridors worth comparing, and
- explain the result.

Follow the steps in order. Each step is a few **actions**, and each action says what to look at, what
to decide, and the command to run. Where a decision isn't clear, take the action's default and say so
in the plan's limitations (Step 5) - don't guess, and don't do work the steps don't ask for. To
update an existing plan with review feedback, follow [Updating a plan](#updating-a-plan) instead.

**Inputs and outputs** (named in your initial prompt):

- The road site model (a JSON file, "SITE.json" below) - the road's start and end points
  (their latitudes and longitudes, labels, and descriptions) and its planning instructions (`notes`)
- The road plan model to write (another JSON file - `<plan>.json`, "PLAN.json" below)
- The work directory for intermediate files (`<plan>.work/`, "WORK" below)

**Tools** (`plan.js` is the planning tools' command in your initial prompt - run it exactly as it's
given there, with its full path, so it runs from any directory; don't change directories):

| Command | Purpose |
| --- | --- |
| `plan.js site SITE.json PLAN.json` | Create the plan's site: its topography grid (USGS lidar terrain), start and end points, streams, roads, trails, exclusion areas, and topographic map image |
| `plan.js plot PLAN.json OUT.png [--box X1,Y1,X2,Y2] [--map]` | Plot the plan's terrain (shaded, with contours), features, and options, with the plan's coordinates along its sides - with `--box`, a part of the plan, for a closer look, and with `--map`, the plan's topographic map (its buildings and labels) in place of its terrain, with the coordinates' grid |
| `plan.js locate PLAN.json [--xy] POINT...` | Convert latitudes and longitudes (`LATITUDE,LONGITUDE`) to the plan's coordinates - or, with `--xy`, the plan's coordinates (`X,Y`) to latitudes and longitudes - with the ground elevation there, and the nearest road and stream |
| `plan.js feature PLAN.json TYPE [-n NAME] X,Y X,Y...` | Add a topographic feature - a `stream`, `road`, or `trail` line, or a `rock` or `exclusion` area polygon - or, with `--remove NAME`, remove the features of a name |
| `plan.js draws PLAN.json [--add NUMBER]...` | List the site's unmapped draws - the valleys of its terrain that drain 3 acres (1.2 hectares) or more and aren't along its streams - or, with `--add`, add draws as streams |
| `plan.js options PLAN.json [options]` | Engineer the plan's standard options - the road that follows the plan's existing roads where that costs less than a new road ("Existing Roads"), and an all-new road ("New Road") - and put the plan's options in cost score order |
| `plan.js route PLAN.json -n NAME [-v X,Y]... [options]` | Engineer another option: a least-cost road through via points |
| `plan.js profile PLAN.json -n NAME [options]` | Re-design an existing option's profile and structures (an update) |
| `plan.js evaluate PLAN.json` | Validate the model and print each option's earthwork, structures, cost breakdown, and design warnings (`--detail` adds a long station table - you don't need it) |
| `plan.js keep PLAN.json NAME...` | Keep the named options, in cost score order (the best first), and remove the others |
| `plan.js draft PLAN.json DESCRIPTIONS.md` | Write a draft of the descriptions - the plan's and each option's facts |
| `plan.js describe PLAN.json DESCRIPTIONS.md` | Set the plan's and the options' descriptions from a Markdown file |
| `plan.js doc [site \| plan]` | Print the road site model's schema documentation - or the road plan model's |

Run a command with `-h` for its arguments.

**Rules**

- **The tools write the plan.** The plan file is large (its elevation grid is most of it) - don't read
  it, and don't change it with your own code.
- **Look at every image you make** with the Read tool - once: don't read an image again. A plot's
  sides have the plan's coordinates (x is east and y is north, from the site's southwest corner), so
  you can read a point's x and y from it. A large site's plot is coarse - plot a part of it with
  `--box X1,Y1,X2,Y2` to see what you're checking. `plot --map` plots the site's topographic map in
  place of its terrain - it has what the terrain lacks (buildings, as small lavender blocks, and
  labels), with the coordinates' grid to find them by.
- **Report only what the tools reported or you saw in a plot.** The lengths, stations, grades, and
  cost scores are the tools' - copy them, don't compute or round them yourself.
- The commands that change the plan are logged in `WORK/commands.txt`, in order - you don't need to
  list them. Put throwaway check images in `WORK/scratch/`.
- If a USGS service fails, wait and run the command again. If `site` fails because the USGS has no
  1 meter elevation models of the site, **stop and tell the user** - don't plan on other terrain.


## Step 1: Read the site model

Read SITE.json: its `title`, `units` (the plan's), `start` and `end` points - each point's `label` and
`description` say what is there and how the road joins it - and its `notes`. **The notes are the
user's instructions**: where they conflict with these instructions' defaults, the notes win.

**Action 1.1 - The road.** Decide the road's width and surface from the notes. They're the `--width`
and `--surface` arguments of every `options` and `route` command you run - use the same ones for every
option, unless an option is a surface variant.

| | Driveway / fire access | Rural access road | Forest / ranch road |
| --- | --- | --- | --- |
| Width | 12-14 ft / 3.7-4.3 m | 14-20 ft / 4.3-6 m | 12-14 ft / 3.7-4.3 m |
| Surface | gravel (asphalt above about 12-15% grade) | gravel or asphalt | gravel or native |
| Maximum grade | 12% (10% where the fire code requires) | 12% | 15% (12% preferred) |
| Minimum radius | 50 ft / 15 m | 50 ft / 15 m | 50 ft / 15 m (70 ft for trucks with trailers) |

*Default:* a single-lane gravel road - no arguments (14 feet / 4.3 meters wide, gravel).

**Action 1.2 - The design criteria.** If the notes (or the table, for the road's type) call for a
maximum grade, minimum radius, or maximum wall height other than the defaults - 12%, 50 feet (15
meters), and 20 feet (6 meters) - set them in SITE.json's `criteria` (`doc site` documents it) before
you create the site. The tools design each road 1% under the maximum grade, and never over it.

*Default:* leave SITE.json as it is.

**Action 1.3 - The notes' places.** List what the notes say the road must avoid, must pass through,
or should follow. You'll find each on the site's plot in Step 2 (and `locate` converts a latitude and
longitude in the notes to the plan's coordinates).


## Step 2: Create and check the site

1. Run `site SITE.json PLAN.json`, and read its output: the grid's size, the elevation range, the
   feature counts, each point's ground elevation and nearest road and stream, and any warnings.
2. Run `plot PLAN.json WORK/site.png` and `plot PLAN.json WORK/map.png --map`, and Read the two
   plots - the site's terrain, and its topographic map. Contours that form V's pointing uphill are
   valleys and draws, V's pointing downhill are ridges and spurs, and wider-spaced contours on a
   slope are a bench.

The elevations are measured - they aren't yours to change. Check what the tools can't know, and
correct the plan's features with `feature` (in the plan's coordinates - to correct a feature, remove
it and add it again). **A site that needs no corrections is common - don't add features to have added
some.**

**Action 2.1 - The start and end points.** *Look:* each point on the plot, and its nearest road and
stream in `site`'s output. *Decide:* is it where its label and description say - on the road it joins,
at the building site - and on ground a road can reach (not in a stream bed)? *Do:* nothing - the
points are the user's. If one looks misplaced, say so in your report and in the plan's limitations.

**Action 2.2 - What the notes say to avoid.** *Look:* each place the notes say the road must avoid
(Action 1.3), on the site's map plot (a `plot --map --box` of it, for a closer look) - the terrain
plot's shading shows buildings' graded pads, too. *Do:* add an `exclusion` polygon around all of it - `feature PLAN.json exclusion -n NAME X,Y
X,Y X,Y...` (its corners, in the plan's coordinates). Check the area and extent that `feature`
reports, and that it doesn't cover the start or end point. Add only the notes' places now - Action
3.4 checks the roads against the map's buildings. Add a `rock` polygon only for rock that the notes
or the map label (an outcrop, a cliff, a quarry) - don't infer rock from steep ground.

**An exclusion is where the road must not go - never move or shrink one to make a road fit.** If the
roads can't avoid it, that's a finding for your report.

*Default:* if you can't find a place the notes name, don't add it - say so in the limitations.

**Action 2.3 - The existing roads.** The plan's `road` features are existing roads that an option may
follow (`trail` features are for reference). *Do:* remove a road the notes rule out (a private drive,
a closed road) - `feature PLAN.json --remove NAME`. Add a `road` only for an existing road that the
notes name, or that plainly shows in the plot's shading as a bench the road could follow - its points
along the bench, read from a `--box` plot.

*Default:* leave the roads as they are.

**Action 2.4 - The streams.** `site` moved each USGS stream to the bottom of its valley, within 100
feet (30 meters). *Look:* each stream on the plot, near where a road might cross it. *Decide:* is it
along the bottom of its valley (the contours' V's)? *Do:* if it's off by more than a road's width
there, remove it and add it again along the valley's bottom.

*Default:* leave the streams as they are.

If you added or changed features, plot the site again (`plot --box` around each one) and Read the plot
to check them.


## Step 3: Engineer the standard options

Run `options PLAN.json` (with the road's `--width` and `--surface`, Action 1.1). It engineers:

- **"Existing Roads"** - the least-cost road that follows the plan's existing roads where that costs
  less than a new road (an existing road is an upgrade, with no earthwork), if it follows any, and
- **"New Road"** - the least-cost all-new road, because the existing roads may not be usable -

and puts the plan's options in cost score order, the best first. (Each road is the cheapest of the
tools' route searches - you don't tune the search.) For each option it reports the
length, the new road's maximum grade and deepest cut and fill, the existing roads it follows (and
their grades as they're built), its structures, its cost score (thousands of dollars - for comparing
options, not a bid estimate), and its design warnings' count. Then act on what it reports - and after
any action that changes the site or its features, **run `options` again**:

**Action 3.1 - `error: no road within the grade limit`.** No road on the site can climb to the end
point within the design grade. *Do:* make the site larger (Action 3.2), once - a larger site has room
for a longer road. If it still fails, **stop and tell the user**: the road needs a higher maximum
grade (SITE.json's `criteria`), which is their decision.

**Action 3.2 - `NOTE: the road is ... from the site's edge`.** The site may be too small for the best
road. *Do:* set SITE.json's `margin` (the distance the site extends beyond the points, in the plan's
units - `site`'s output has the site's size) to half again what it is, and run `site` and then
`options` again - at most twice. `site` keeps the plan's options and the features you added, and
reports how far the plan's coordinates moved (coordinates in your notes are stale). The USGS's roads
and streams are the site's again: remove again those you removed.

**Action 3.3 - `NOTE: the road crosses ... unmapped draws`.** A draw is a valley that carries water
in a storm - a road that crosses one needs a culvert there, and the plan only has culverts at its
streams. *Look:* each draw at its crossing (`plot --box` around the note's X,Y). *Decide:* is it a
valley on open ground (contour V's)? *Do:* add the draws that are, in one command - `draws PLAN.json
--add NUMBER --add NUMBER...` (each is named "Draw NUMBER", and a draw's number doesn't change when
others are added). Skip a draw that's a street's gutter, a roadside ditch, or a graded lot. For one
draw, `-n NAME` names it, and `--end X,Y` ends it where it runs on into a street or a house lot.
Repeat until `options` notes no draws but those you skipped.

*Default:* add the draw - a culvert is the cautious choice.

**Action 3.4 - The roads against the map.** *Look:* `plot PLAN.json WORK/options.png --map` - the
options on the site's topographic map. *Decide:* does a road cross a building, or the yard around one?
*Do:* add an `exclusion` polygon around that building's lot (Action 2.2 - it's an assumption: say so
in the plan's description), and run `options` again.

*Default:* add nothing - a road across open ground needs no exclusions.

**Action 3.5 - Design warnings.** `options` reports each option's design warnings' count, and
`evaluate PLAN.json` lists them. An option whose warnings you can't justify in its description (an
existing road's condition, say) is dropped in Step 5 - don't change the site to remove a warning.


## Step 4: Other corridors

The standard options are the tools' least-cost roads. Engineer another corridor only where:

- **the notes ask for it** - a place to pass through, a road to follow, a side of the hill - or
- **the site's plot shows a clearly different way** - the other side of a hill, another valley, an
  existing road that the standard options don't use - that a reviewer would want compared. At most
  two of these.

*Do:* `route PLAN.json -n NAME -v X,Y` (with the road's width and surface), where the via point is
on gentle ground in the middle of the corridor, read from the plot - one via point, or two for a long
corridor, and not at turns. Name the option for its corridor ("West Contour", "Creek Road"). Then:

- `NOTE: the road turns back at the via point` - the point is off the road's corridor: move it along
  the corridor, or drop it, and engineer the option again.
- `error: no road within the grade limit` - the corridor is too short or too steep: try one other via
  point, then give the corridor up.
- `NOTE: the road is ... from the site's edge` - the via point is too far out: move it in. (Action
  3.2's larger site is for the standard options.)
- `NOTE: the road crosses ... unmapped draws` - Action 3.3.

Give a corridor two attempts, not more - the second with the same name, so it replaces the first.
Record each corridor you give up or drop, with its cost score - the plan's description lists them.

*Default:* no other corridors - the standard options are the plan.

**Variants** are options too, where the notes ask for them or they change the comparison: a bridge
instead of a deep stream crossing fill (`--bridge-fill DEPTH`), asphalt instead of gravel on a steep
road (`--surface asphalt`), or an all-new corridor (`--all-new`).


## Step 5: Finalize the plan

1. **Keep one to four options**: `keep PLAN.json NAME...` (it puts them in cost score order). Keep
   the best option - the lowest cost score without unresolved design warnings. Keep another only if
   it has no unresolved design warnings and it's a real choice against the best: it doesn't depend on
   an existing road that the best follows, it's a different corridor (Step 4), or the notes prefer
   it. Its length and earthwork are in its cost score already - they aren't reasons to keep it.
2. **Draft the descriptions**: `draft PLAN.json WORK/descriptions.md` writes the plan's and each
   option's facts. Edit the file - **don't delete or reword its lines** - and add only these, each
   as its own short paragraph or bullet (make each a small edit of its own):
   - *The plan* (under `# Plan`):
     - First, one or two sentences on the road and its purpose, from the notes.
     - Under the added features, one sentence for each: what it is and why you added it (and that
       it's an assumption, if the notes didn't name it). Skip this if you added none.
     - One sentence for each option you engineered and didn't keep, with its cost score. Skip this
       if there were none.
     - After the limitations, one sentence for each thing you defaulted or couldn't do - a
       misplaced point, a place you couldn't find. Skip this if there were none.
   - *Each option* (under `# Option: NAME`), after its first paragraph:
     - Two or three sentences on its corridor - where it goes, from the plot - and, if it isn't the
       best option, why it's kept.
     - After its last bullet, one sentence on what to verify in the field that the draft doesn't
       say already, and how each of its design warnings is resolved or justified.

   **Keep it short, and don't repeat the draft** - its numbers, structures, criteria, and
   limitations are there already, and a reader has them. Check each direction you write (north,
   east, uphill) against the plot's coordinates - x is east, y is north. Don't write `~` for
   "about" - the viewer's Markdown renders `~...~` as strikethrough.
3. **Set the descriptions**: `describe PLAN.json WORK/descriptions.md`.
4. **Check the plan**: run `evaluate PLAN.json` (the model must validate), then `plot PLAN.json
   WORK/plan.png` and Read it - each road should run from the start point to the end point, along the
   terrain as its description says.


## Step 6: Report

Finish with a short summary for the user: a table of the options (length, maximum grade, earthwork,
walls and bridges, cost score - `evaluate`'s numbers, and the walls and bridges of the draft's
structures), the recommended option and why, any caveats (the limitations), and how to view the plan:
run the Roadie application (`make run`, in the `roadie` folder), and open `<plan>.json` with "Open
Plan".


## Updating a plan

A plan often needs changes after review - comments from the city or county (planning, fire marshal,
public works), a surveyor, the owner, or a contractor. When your initial prompt asks you to **update**
an existing road plan model, follow these steps instead of Steps 1-6. Your initial prompt names the
plan JSON file and its work directory. Ask the user for the feedback (pasted text or a file path)
before making any changes.

1. **Read the current plan.** Run `evaluate PLAN.json` to record every option's length, maximum
   grade, earthwork, warnings, and cost score, and plot it (`plot`). Read the road site model
   (the plan's `site` member - a plan made before plans kept their site models doesn't have it), and
   in the work directory, `descriptions.md` (the plan's
   descriptions) and `commands.txt` (the commands that made the plan, in order).
2. **Save a copy** of the plan JSON in the work directory before changing it, named with today's date
   (`<plan>.<YYYY-MM-DD>.json`), so the update can be compared against or reverted.
3. **List the feedback items**, and classify each as one of these. Restate them to the user, with how
   you'll address each, and ask about anything ambiguous before making changes (a setback distance
   without the line it's measured from, say):
   - **Design criteria** - a maximum grade (fire code 10%), minimum radius, or wall height: set
     SITE.json's `criteria`, and run `site` again. A road width, surface, or slopes: the `options` and
     `route` commands' arguments.
   - **Site features** - new or corrected exclusion areas (setbacks, easements, wetland buffers,
     property lines), streams, roads, or rock: `feature` adds and removes them (`locate` converts
     latitudes and longitudes to the plan's coordinates).
   - **The site** - a larger site or a finer grid: edit SITE.json (`margin`, `spacing`) and run `site`
     again, then check the site (Step 2). A moved start or end point changes the plan's coordinates:
     `site` stops, and the road is planned again in a new plan (Steps 1-6).
   - **Cost rates** - local unit prices or a contractor's quote: SITE.json's `costRates`, and run
     `site` again.
   - **Option changes** - a different corridor, a road moved off something, or dropping or adding an
     option: `route` with via points (Step 4), an `exclusion` feature, and `keep`.
   - **Required structures** - a bridge instead of a fill: `route` with `--bridge-fill`. A culvert
     size, or a turnout's place: change that structure in the option's `structures` in the plan file
     (`doc plan` documents them) - the one change to the plan that isn't a tool's. Find it by its
     station with a text search, and change only its members.
4. **Engineer the options again.** `site` keeps the plan's options and the features that were added,
   but their profiles are stale: run `options` again (Step 3, with its actions), and run again each
   other option's `route` command from `commands.txt`. If an option can no longer be within the grade
   limit, say why it's dropped.
5. **Finalize** (Step 5): `keep` the options, and update the descriptions - `draft PLAN.json
   WORK/draft.md` has the new facts; bring them into `descriptions.md`, keeping what the planning
   session wrote that's still true. Add a **revision history** to the end of the plan's description
   - one bullet per update, with the date, the feedback's source, and the changes made - and address
   each feedback item where it applies ("the 10% fire code grade adds a switchback near station
   6+00"). Then `describe`, `evaluate`, and `plot`.
6. **Report** a before-and-after table of every option (length, maximum grade, earthwork, walls and
   bridges, cost score), how each feedback item was addressed (or why it couldn't be), any new
   caveats, and the command to view the plan.


## Reference: road engineering

The tools apply these - they're here to judge a corridor before you try it (Step 4) and to explain an
option (Step 5). They come from the USFS *Low-Volume Roads Engineering Best Management Practices
Field Guide* (Keller & Sherar), AASHTO low-volume road guidance, and fire codes (IFC Appendix D).

- **Grade.** Roads are designed 1% under the maximum grade, and switchbacks at 8% or less. Where the
  straight line between two points is steeper than that, the road between them is longer - it
  contours, or it switches back.
- **Side slope.** Earthwork grows fast with side slope: a road on a 50% side slope moves about ten
  times the earth of one on a 10% side slope. Above about 60%, cut and fill slopes don't meet the
  ground, and the road needs retaining walls (about $60 per square foot of face) - a road that needs
  many is in the wrong place.
- **Corridors.** Good roads follow the contours on moderate side slopes, cross ridges at saddles,
  climb on spur crests, put switchbacks on benches, and cross drainages at narrow points, square to
  them.
- **Earthwork balance.** Cut that becomes nearby fill is cheap. Importing fill (borrow) and exporting
  cut (waste) cost extra - an option's borrow or waste is in its draft description.
- **Drainage.** Every stream and draw crossing has a culvert, and a bridge replaces a very deep
  crossing fill (more than about 25 feet / 8 meters).
- **Existing roads.** A road that follows an existing road is an upgrade - no earthwork - but its
  grade and curves are as they're built, and may not meet the criteria. The tools report its grade.
- **Turnouts and turnarounds.** The tools add turnouts to single-lane roads. A dead-end road also
  needs a turnaround at its end - it isn't modeled.


## Reference: the cost score

The cost score is the estimated construction cost in thousands of nominal US dollars (2023-2025 unit
prices), for comparing options - not a bid estimate. Default unit rates (SITE.json's `costRates`
overrides them, in dollars per metric unit, for local prices):

| Item | Default rate |
| --- | --- |
| Clearing and grubbing | $8,000 / acre of disturbed area |
| Common excavation | $15 / CY |
| Rock excavation | $75 / CY |
| Embankment placement and compaction | $5 / CY |
| Borrow (import) | $20 / CY |
| Waste (export) | $8 / CY |
| Overhaul (beyond 500 ft free haul) | about $3 / CY-mile |
| Aggregate surfacing | about $16 / SY |
| Asphalt paving (with base) | about $33 / SY |
| Ditches and cross drains | about $14 / LF of road |
| Culverts | about $120 / LF (18 in) to $250 / LF (36 in), plus $3,000 per end |
| Retaining walls | about $60 / SF of face |
| Bridges | about $250 / SF of deck |
| Existing road upgrade (reshaping, gravel lift, ditch cleaning, minor widening) | about $11 / SY of road |
| Erosion control and revegetation | $3,000 / acre of disturbed area |
| Mobilization | 10% |

Shrinkage: 1 CY of common excavation makes 0.87 CY of compacted fill; rock swells to 1.1 CY.
