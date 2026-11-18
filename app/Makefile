# The Roadie application - a Python package (python-build): its command line serves the Roadie front end (the viewer)
# and the back end that reads and writes a road's files - its road site model and its road plan model

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


# The application isn't published
GHPAGES_SRC :=


# Include python-build
include Makefile.base


# Disable pylint docstring warnings
PYLINT_ARGS := $(PYLINT_ARGS) --disable=missing-class-docstring --disable=missing-function-docstring --disable=missing-module-docstring


# The Roadie viewer project and planning tools project - the viewer's staged application is the package's front end,
# with the planning tools' modules (they plan a road in the browser) and their elevation models' reader
VIEWER := ../viewer
PLAN := ../plan
STATIC := src/roadie/static


help:
	@echo "            [run|static]"
	@echo ""
	@echo "  make static           Stage the front end (the viewer's application and the planning tools) in the package"
	@echo "  make run ARGS=...     Serve a road (ARGS are the roadie command's - the road site and road plan files)"


clean:
	rm -rf Makefile.base pylintrc src/roadie/static


# Stage the front end in the package - the viewer's application, the planning tools' modules ("plan/lib/" - the
# application's page maps their imports), and the GeoTIFF reader's script
.PHONY: static
static:
	@$(MAKE) --no-print-directory -C $(VIEWER) app
	@$(MAKE) --no-print-directory -C $(PLAN) build/npm.build
	rm -rf src/roadie/static
	mkdir -p $(STATIC)/plan
	cp -R $(VIEWER)/build/app/. $(STATIC)/
	cp -R $(PLAN)/lib $(STATIC)/plan/
	cp $(PLAN)/node_modules/geotiff/dist-browser/geotiff.js $(STATIC)/


# Serve a road - its road site model's file and its road plan model's
.PHONY: run
run: $(DEFAULT_VENV_BUILD) static
	$(DEFAULT_VENV_BIN)/roadie$(if $(ARGS), $(ARGS))
