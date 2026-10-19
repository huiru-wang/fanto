#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
location_test_dir=$(mktemp -d)
trap 'rm -rf "$location_test_dir"' EXIT
xcrun swiftc -parse-as-library -swift-version 6 \
  "$project_root/apps/ios/fanto/fanto/Models/RecordLocation.swift" \
  "$project_root/apps/ios/fanto/fanto/Records/RecordLocationFormatter.swift" \
  "$project_root/apps/ios/tests/LocationTests.swift" \
  -o "$location_test_dir/location-tests"
"$location_test_dir/location-tests"
