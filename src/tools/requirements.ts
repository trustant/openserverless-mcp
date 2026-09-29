// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import { readFileSync, existsSync } from "node:fs"
import { z } from "zod"
import { parseEndpoint, error, status, defineTool, endpointArg } from "../lib.ts"

// The OpenServerless Python 3.12 action runtime's requirements.txt, vendored
// verbatim at the package root. Refresh it (and the acp copy) from:
// https://raw.githubusercontent.com/trustable-ai/openserverless-runtimes/refs/heads/0.9.0/runtime/python/v3.12/requirements.txt
export const RUNTIME_REQUIREMENTS_PATH = new URL("../../requirements.txt", import.meta.url)

/** PEP 503 name of a requirement spec, without extras, markers or version. */
export function normalizeRequirement(spec: string): string {
  const name = spec.trim().match(/^[A-Za-z0-9][A-Za-z0-9._-]*/)?.[0] ?? ""
  return name.toLowerCase().replace(/[-_.]+/g, "-")
}

/**
 * PEP 503 names of every pinned distribution in a pip-compile output. Direct
 * and transitive entries are all importable in the runtime, so all count.
 */
export function parseRuntimeRequirements(text: string): string[] {
  const names = new Set<string>()
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#") || line.startsWith("-")) continue
    const name = normalizeRequirement(line)
    if (name) names.add(name)
  }
  return [...names].sort()
}

let runtimeLibrariesCache: readonly string[] | undefined

/**
 * Libraries the action runtime ships. A missing or empty file throws: falling
 * back to "anything goes" would let the agent add libraries that fail only
 * after deploy.
 */
export function runtimeLibraries(): readonly string[] {
  if (!runtimeLibrariesCache) {
    const libraries = parseRuntimeRequirements(readFileSync(RUNTIME_REQUIREMENTS_PATH, "utf-8"))
    if (libraries.length === 0) throw new Error(`runtime requirements are empty: ${RUNTIME_REQUIREMENTS_PATH.pathname}`)
    runtimeLibrariesCache = libraries
  }
  return runtimeLibrariesCache
}

/**
 * Check a library against the action runtime. Actions may use only what the
 * runtime ships, so this never writes a requirements.txt: a shipped library
 * needs nothing, and anything else must be implemented in code.
 */
export function ensurePythonRequirement(dir: string, library: string): string {
  const lib = library.trim()
  if (!lib) return "Error: library name cannot be empty"
  if (!existsSync(dir)) return `Error: endpoint not found at ${dir}`

  if (runtimeLibraries().includes(normalizeRequirement(lib))) {
    return `Library '${lib}' is preinstalled in the action runtime and available. No action needed.`
  }
  return `Error: library '${lib}' is not available in the OpenServerless Python runtime and new requirements are not allowed. Implement it in code with the standard library and the runtime libraries: ${runtimeLibraries().join(", ")}.`
}

export default defineTool({
  name: "action_requirements",
  config: {
    description: "Check that a Python library is available in the action runtime. Actions may use only the libraries the runtime ships; anything else is refused and must be implemented in code. Never writes requirements.txt.",
    inputSchema: {
      endpoint: endpointArg,
      library: z.string().describe("The Python library name to check"),
    },
  },
  handler({ endpoint, library }) {
    let ep
    try {
      ep = parseEndpoint(endpoint)
    } catch (e) {
      return error(`Error: ${(e as Error).message}`)
    }
    return status(ensurePythonRequirement(ep.dir, library))
  },
})
