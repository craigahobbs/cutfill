# The Cutfill application - a Python package (python-build): its command line serves the Cutfill front end (the viewer)
# and the planning tools - the front end opens, runs, and saves plans in the browser

# Download python-build
PYTHON_BUILD_DIR ?= ../../python-build
define WGET
ifeq '$$(wildcard $(notdir $(1)))' ''
$$(info Downloading $(notdir $(1)))
$$(shell [ -f $(PYTHON_BUILD_DIR)/$(notdir $(1)) ] && cp $(PYTHON_BUILD_DIR)/$(notdir $(1)) . || $(call WGET_CMD, $(1)))
endif
endef
WGET_CMD = if command -v wget >/dev/null 2>&1; then wget -q -c $(1); else curl -f -Os $(1); fi
$(eval $(call WGET, https://craigahobbs.github.io/python-build/Makefile.base))
$(eval $(call WGET, https://craigahobbs.github.io/python-build/pylintrc))


# Include python-build
include Makefile.base


# Disable pylint docstring warnings
PYLINT_ARGS := $(PYLINT_ARGS) --disable=missing-class-docstring --disable=missing-function-docstring --disable=missing-module-docstring


# The Cutfill viewer project and planning tools project - the viewer's staged application is the package's front end,
# with the planning tools' modules (they plan a road in the browser) and their elevation models' reader
VIEWER := ../viewer
PLAN := ../plan
STATIC := src/cutfill/static


help:
	@echo "            [run|static]"
	@echo ""
	@echo "  make static           Stage the front end (the viewer's application and the planning tools) in the package"
	@echo "  make run [ARGS=...]   Run the application (ARGS are the cutfill command's options)"


clean:
	rm -rf Makefile.base pylintrc


# Stage the front end in the package - the viewer's application, and the planning tools' modules ("plan/lib/" - the
# application's page maps their imports - but for the command line's, which a browser doesn't load). The staged front
# end is committed - the package builds from the repository without Node.js - so it's staged before the
# package's environment's commands (its tests, say): the pre-commit gate keeps it the sources'.
.PHONY: static
$(DEFAULT_VENV_BUILD): | static
static:
	@$(MAKE) --no-print-directory -C $(VIEWER) app
	rm -rf src/cutfill/static
	mkdir -p $(STATIC)/plan
	cp -R $(VIEWER)/build/app/. $(STATIC)/
	cp -R $(PLAN)/lib $(STATIC)/plan/
	rm $(STATIC)/plan/lib/cli.js


# The changelog covers the repository, so it's the top level's (../CHANGELOG.md) - python-build's changelog command
# updates the package directory's, so the top level's is moved here before it runs, and back after
CHANGELOG_UTIL := changelog-$(call IMAGE_NAME_FN, $(firstword $(PYTHON_IMAGES)))-util
$(CHANGELOG_UTIL): changelog-in
.PHONY: changelog-in
changelog-in:
	if [ -f ../CHANGELOG.md ]; then mv ../CHANGELOG.md CHANGELOG.md; fi
changelog:
	if [ -f CHANGELOG.md ]; then mv CHANGELOG.md ../CHANGELOG.md; fi


# Run the application
.PHONY: run
run: $(DEFAULT_VENV_BUILD) static
	$(DEFAULT_VENV_BIN)/cutfill$(if $(ARGS), $(ARGS))
