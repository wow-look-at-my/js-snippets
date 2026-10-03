# The package's own binaries come first on PATH, as npm run puts them.
export PATH := justfile_directory() + "/node_modules/.bin:" + env_var("PATH")

# The npm script build.
build:
	ts0 build && node scripts/build-llms.mjs

# The npm script build:showcase.
build-showcase:
	cd showcase && ts0 build

# The npm script test.
test:
	ts0 test
