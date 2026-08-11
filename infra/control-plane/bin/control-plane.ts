import { App } from "aws-cdk-lib";
import { ControlPlaneStack } from "../lib/control-plane-stack.ts";

const app = new App();
new ControlPlaneStack(app, "OpenSidebarControlPlane");
