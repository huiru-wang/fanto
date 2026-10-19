#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
cache_test_dir=$(mktemp -d)
trap 'rm -rf "$cache_test_dir"' EXIT
xcrun swiftc -parse-as-library -swift-version 6 \
  "$project_root/apps/ios/fanto/fanto/Store/AccountCacheDisk.swift" \
  "$project_root/apps/ios/fanto/fanto/Store/CachedResource.swift" \
  "$project_root/apps/ios/fanto/fanto/Models/UserProfileModels.swift" \
  "$project_root/apps/ios/fanto/fanto/Models/CharacterPrompt.swift" \
  "$project_root/apps/ios/fanto/fanto/Models/FantoSettings.swift" \
  "$project_root/apps/ios/fanto/fanto/Models/RecordLocation.swift" \
  "$project_root/apps/ios/fanto/fanto/Store/RecordDraftStore.swift" \
  "$project_root/apps/ios/tests/CacheTests.swift" \
  -o "$cache_test_dir/cache-tests"
"$cache_test_dir/cache-tests"
