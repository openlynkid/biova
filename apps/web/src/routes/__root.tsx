import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Biova — Your space, your rules" },
      { name: "description", content: "A modular home for your creator identity, content and commerce." },
      // Defaults for every page; the public creator page overrides the
      // per-page ones (title, description, og:title) with its own values.
      { name: "robots", content: "index, follow" },
      { name: "theme-color", content: "#0b0b12" },
      { property: "og:site_name", content: "Biova" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
