import { defineConfig, InputTransformerFn } from "orval";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

// Orval 8 ignores the legacy `output.prettier` option. Its supported
// `formatter: "prettier"` rewrites the generator's existing style wholesale,
// so stabilize only the extra blank runs via Orval's generated-path hook.
async function stabilizeGeneratedWhitespace(generatedPaths: string[]) {
  const visited = new Set<string>();

  const visit = async (generatedPath: string): Promise<void> => {
    const absolutePath = path.resolve(generatedPath);
    if (visited.has(absolutePath)) return;
    visited.add(absolutePath);

    const entry = await stat(absolutePath);
    if (entry.isDirectory()) {
      await Promise.all(
        (await readdir(absolutePath)).map((name) =>
          visit(path.join(absolutePath, name)),
        ),
      );
      return;
    }
    if (!absolutePath.endsWith(".ts")) return;

    const source = await readFile(absolutePath, "utf8");
    const stabilized = `${source
      .replace(/\r\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trimEnd()}\n`;
    if (stabilized !== source) {
      await writeFile(absolutePath, stabilized);
    }
  };

  await Promise.all(generatedPaths.map(visit));
}

export default defineConfig({
  "api-client-react": {
    hooks: {
      afterAllFilesWrite: [stabilizeGeneratedWhitespace],
    },
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    hooks: {
      afterAllFilesWrite: [stabilizeGeneratedWhitespace],
    },
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      override: {
        zod: {
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
