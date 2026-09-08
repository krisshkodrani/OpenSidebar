#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { SandboxStack } from "../lib/sandbox-stack.js";

const app = new cdk.App();
new SandboxStack(app, "OpenSidebarSandbox", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "eu-central-1",
  },
});
