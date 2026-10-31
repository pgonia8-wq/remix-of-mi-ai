import { createElement } from "react";
import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ messages: [] as { id: string; role: string; content: string }[] }));
vi.mock("@/lib/use-app", () => ({
  useActiveProjectId: () => "project-id",
  useMutate: () => vi.fn(),
  useRepoQuery: (key: string[]) => ({
    data: key[0] === "chat" ? { id: "chat-id", title: "Chat" } : key[0] === "messages" ? state.messages : [],
    refetch: vi.fn(),
  }),
}));
vi.mock("@tanstack/react-router", async importOriginal => ({
  ...await importOriginal<typeof import("@tanstack/react-router")>(),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { Route } from "@/routes/chat.$chatId";

afterEach(() => { vi.restoreAllMocks(); state.messages = []; });

it("does not return a scroll promise as React cleanup when messages change or the chat closes", () => {
  vi.spyOn(Route, "useParams").mockReturnValue({ chatId: "chat-id" });
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  const scroll = vi.fn(() => Promise.resolve());
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  const Component = Route.options.component;
  if (!Component) throw new Error("Chat component missing");
  try {
    const view = render(createElement(Component));
    expect(scroll).toHaveBeenCalledTimes(1);
    state.messages = [{ id: "message-id", role: "user", content: "hola" }];
    expect(() => view.rerender(createElement(Component))).not.toThrow();
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(() => view.unmount()).not.toThrow();
  } finally {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});