# The Roadie application - a Python package (python-build): its command line serves the Roadie front end (the viewer)
# and the back end that reads and writes a directory's road site and road plan files

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


# The Roadie viewer project - its staged application is the package's front end
VIEWER := ../viewer
STATIC := src/roadie/static


help:
	@echo "            [run|static]"
	@echo ""
	@echo "  make static           Stage the front end (the viewer's application) in the package"
	@echo "  make run [ARGS=...]   Serve a directory's roads (ARGS are the roadie command's - the directory, say)"


clean:
	rm -rf Makefile.base pylintrc src/roadie/static


# Stage the front end in the package - the viewer's application
.PHONY: static
static:
	@$(MAKE) --no-print-directory -C $(VIEWER) app
	rm -rf src/roadie/static
	mkdir -p $(STATIC)
	cp -R $(VIEWER)/build/app/. $(STATIC)/


# Serve a directory's roads
.PHONY: run
run: $(DEFAULT_VENV_BUILD) static
	$(DEFAULT_VENV_BIN)/roadie$(if $(ARGS), $(ARGS))
