#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { FleetTelemetryStack } from "../lib/fleet-telemetry-stack.ts";

const app = new cdk.App();
const telemetryRegion =
  process.env.TELEMETRY_AWS_REGION ?? "eu-central-1";
new FleetTelemetryStack(app, "OpenSidebarFleetTelemetry", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: telemetryRegion,
  },
  description:
    "Optional OpenSidebar fleet telemetry ingest and query infrastructure (RFC LP-25).",
});
