import { ThreadriftProvider } from "../context/ThreadriftContext";
import { ThreadriftCanvas } from "./ThreadriftCanvas";
import { ThreadriftNavigation } from "./ThreadriftNavigation";
import { Threadrift as ThreadriftApp } from "./Threadrift";
import { Node } from "./Node";

export const Threadrift = {
  Root: ThreadriftProvider,
  Canvas: ThreadriftCanvas,
  Navigation: ThreadriftNavigation,
  Node: Node,
  App: ThreadriftApp,
};
