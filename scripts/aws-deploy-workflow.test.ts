// @vitest-environment node
// The release workflow's shape: what it may run on, what it may do, and
// that every action is pinned to a commit.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface Step {
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}
interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<
    string,
    {
      if: string;
      environment: string;
      permissions: Record<string, string>;
      steps: Step[];
    }
  >;
}

const text = readFileSync(
  new URL("../.github/workflows/aws-deploy.yml", import.meta.url),
  "utf8",
);
const workflow = parse(text) as Workflow;
const job = workflow.jobs.deploy;
if (!job) throw new Error("no deploy job");
const steps = job.steps;
const at = (match: (step: Step) => boolean) => steps.findIndex(match);

describe("aws-deploy.yml", () => {
  it("runs only by hand", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  });

  it("runs one release at a time and never cancels one", () => {
    expect(workflow.concurrency).toEqual({
      group: "aws-deploy",
      "cancel-in-progress": false,
    });
    expect(Object.keys(workflow.jobs)).toEqual(["deploy"]);
  });

  it("runs only in this repository, from main or a tag", () => {
    expect(job.if).toContain(
      "github.repository == 'au-fairpro/fairpro-editor'",
    );
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    expect(job.if).toContain("startsWith(github.ref, 'refs/tags/')");
  });

  it("uses the aws-editor environment the deploy role trusts, with least privilege", () => {
    expect(job.environment).toBe("aws-editor");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });
  });

  it("pins every action to a full commit with its version", () => {
    const uses = [...text.matchAll(/uses: (\S+)(.*)/g)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, ref, comment] of uses) {
      expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(comment).toMatch(/^ # v\d+\.\d+\.\d+$/);
    }
  });

  it("builds as the repository does, after its checks", () => {
    const install = at((s) => s.run === "pnpm install --frozen-lockfile");
    const check = at((s) => s.run === "pnpm check");
    const build = at((s) => s.run === "pnpm build");
    expect(install).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(install);
    expect(build).toBeGreaterThan(check);
    expect(steps[0]?.with?.["persist-credentials"]).toBe(false);
  });

  it("takes credentials only after building, from the environment's role", () => {
    const credentials = at((s) =>
      (s.uses ?? "").startsWith("aws-actions/configure-aws-credentials@"),
    );
    expect(credentials).toBeGreaterThan(at((s) => s.run === "pnpm build"));
    expect(steps[credentials]?.with).toMatchObject({
      "role-to-assume": "${{ vars.AWS_DEPLOY_ROLE_ARN }}",
      "aws-region": "ap-southeast-2",
    });
    expect(JSON.stringify(steps[credentials]?.with)).not.toMatch(
      /secret|access-key/i,
    );
  });

  it("deploys through the tested script, with the environment's bucket and distribution", () => {
    const deploy = at(
      (s) => s.run === "node scripts/aws-deploy.ts deploy dist",
    );
    expect(deploy).toBeGreaterThan(
      at((s) =>
        (s.uses ?? "").startsWith("aws-actions/configure-aws-credentials@"),
      ),
    );
    expect(steps[deploy]?.env).toEqual({
      EDITOR_BUCKET: "${{ vars.EDITOR_BUCKET }}",
      EDITOR_DISTRIBUTION_ID: "${{ vars.EDITOR_DISTRIBUTION_ID }}",
    });
    // No AWS command outside the script, whose order is unit tested.
    for (const step of steps) {
      expect(step.run ?? "").not.toMatch(/\baws /);
    }
  });

  it("checks the served headers last, when given an address", () => {
    const last = steps.at(-1);
    expect(last?.run).toContain("node scripts/aws-deploy.ts check-headers");
    expect(last?.if).toContain("vars.EDITOR_CHECK_URL");
  });
});
