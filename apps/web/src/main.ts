import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import icon from "../../../assets/logo/zeolite-icon.svg";

// Set from the bundle so the single-file builds carry their own icon.
const link = document.createElement("link");
link.rel = "icon";
link.type = "image/svg+xml";
link.href = icon;
document.head.append(link);

export default mount(App, { target: document.getElementById("app")! });
