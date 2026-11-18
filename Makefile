# Roadie's top-level makefile - it delegates to the project's subprojects:
#
#   viewer/  The Roadie viewer - a JavaScript web application (javascript-build)
#   plan/    The planning tools - JavaScript (javascript-build)
#   app/     The Roadie application - a Python package that serves the viewer and the planning tools (python-build)

.DEFAULT_GOAL := help


# Delegate a target to a subproject - other variables given on the command line (TEST, ...) are passed along by make
SUBMAKE = @$(MAKE) --no-print-directory -C $(1) $(2)


.PHONY: help
help:
	@echo "usage: make [clean|commit|gh-pages|lint|run|site|superclean|test]"
	@echo ""
	@echo "  make run          Run the Roadie application, in the browser - open, make, run, and save plans"
	@echo "  make commit       Run the viewer's, the planning tools', and the application's tests and lint"
	@echo "  make test         Run the tests (TEST=<name> runs the viewer's and the planning tools' tests of a name)"
	@echo "  make lint         Lint the viewer, the planning tools, and the application"
	@echo "  make site         Stage the project's web site (build/gh-pages/)"
	@echo "  make gh-pages     Update the project's gh-pages branch checkout (../roadie.gh-pages)"


# The pre-commit gate, and its parts - the viewer's (tests, lint, documentation, and 100% coverage), the planning
# tools' (tests and lint), and the application's (tests, lint, and 100% coverage)
.PHONY: commit test lint
commit test lint:
	$(call SUBMAKE,viewer,$@)
	$(call SUBMAKE,plan,$@)
	$(if $(TEST),,$(call SUBMAKE,app,$@))
	@if [ -n "$$(git status --porcelain app/src/roadie/static 2>/dev/null)" ]; then \
		echo 'note: the application front end (app/src/roadie/static/) changed - commit it with its sources'; fi


# Run the Roadie application, in the browser
.PHONY: run
run:
	@$(MAKE) --no-print-directory -C app run


# Stage the project's web site - the documentation at its root (index.html renders README.md), the example plan, and
# the viewer application (and its README) in viewer/. The site's READMEs link to the other Markdown documents as
# rendered Markdown ("#url=viewer/README.md&<header ID>"), not to the Markdown files. The site's viewer has the example
# plan's URL (its page element's "data-example" attribute), so its home page links to it.
SITE_LINKS := sed -E 's/\]\(([^):\#]*\.md)\#([^)]*)\)/](\#url=\1\&\2)/g; s/\]\(([^):\#]*\.md)\)/](\#url=\1)/g'

.PHONY: site
site:
	$(call SUBMAKE,viewer,app)
	rm -rf build/gh-pages/
	mkdir -p build/gh-pages/example/
	cp index.html build/gh-pages/
	$(SITE_LINKS) README.md > build/gh-pages/README.md
	cp example/site.json example/example.json example/screenshot.png build/gh-pages/example/
	cp -R viewer/build/app build/gh-pages/viewer
	sed 's|<div id="roadie">|<div id="roadie" data-example="../example/example.json">|' viewer/build/app/index.html \
		> build/gh-pages/viewer/index.html
	grep -q 'data-example="../example/example.json"' build/gh-pages/viewer/index.html
	$(SITE_LINKS) viewer/README.md > build/gh-pages/viewer/README.md


# Update the project's gh-pages branch checkout (../roadie.gh-pages) with the web site - commit and push it to publish.
# The site is staged after the pre-commit gate (not with it, under "make -j") - both stage the viewer application.
.PHONY: gh-pages
gh-pages: commit
	@$(MAKE) --no-print-directory site
	if [ ! -d ../$(notdir $(CURDIR)).gh-pages ]; then git clone -b gh-pages `git config --get remote.origin.url` ../$(notdir $(CURDIR)).gh-pages; fi
	cd ../$(notdir $(CURDIR)).gh-pages && git pull
	rsync -rv --delete --exclude=.git/ build/gh-pages/ ../$(notdir $(CURDIR)).gh-pages
	touch ../$(notdir $(CURDIR)).gh-pages/.nojekyll


# Remove the build directories
.PHONY: clean superclean
clean superclean:
	$(call SUBMAKE,viewer,$@)
	$(call SUBMAKE,plan,$@)
	$(call SUBMAKE,app,$@)
	rm -rf build/
