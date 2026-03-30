import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider, createTheme } from "@mantine/core";
import { describe, beforeEach, afterEach, expect, test, vi } from "vitest";
import AddModelModal from "./AddModelModal.jsx";

const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "lg",
  fontFamily: "Manrope, Inter, system-ui, sans-serif",
});

function renderWithMantine(ui) {
  return render(<MantineProvider theme={theme}>{ui}</MantineProvider>);
}

describe("AddModelModal", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("shows only text-only catalog models from OpenRouter", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "zeta/text-model",
            name: "Zeta Text",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
          },
          {
            id: "alpha/plain-model",
            name: "Alpha Plain",
            architecture: {
              input_modalities: ["text"],
            },
          },
          {
            id: "vision/mixed-model",
            name: "Vision Mixed",
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["text"],
            },
          },
          {
            id: "audio/non-text-output",
            name: "Audio Output",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["audio"],
            },
          },
        ],
      }),
    });

    renderWithMantine(
      <AddModelModal opened onClose={() => {}} onAdd={() => {}} apiKey="test-key" />
    );

    expect(await screen.findByText("Alpha Plain")).toBeInTheDocument();
    expect(screen.getByText("Zeta Text")).toBeInTheDocument();
    expect(screen.queryByText("Vision Mixed")).not.toBeInTheDocument();
    expect(screen.queryByText("Audio Output")).not.toBeInTheDocument();

    const visibleNames = screen
      .getAllByText(/Alpha Plain|Zeta Text/)
      .map((node) => node.textContent);
    expect(visibleNames).toEqual(["Alpha Plain", "Zeta Text"]);
  });

  test("hides models with missing modality metadata instead of guessing", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "missing/architecture",
            name: "Missing Architecture",
          },
          {
            id: "missing/input-modalities",
            name: "Missing Input",
            architecture: {
              output_modalities: ["text"],
            },
          },
          {
            id: "eligible/text-model",
            name: "Eligible Text",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
          },
        ],
      }),
    });

    renderWithMantine(
      <AddModelModal opened onClose={() => {}} onAdd={() => {}} apiKey="test-key" />
    );

    expect(await screen.findByText("Eligible Text")).toBeInTheDocument();
    expect(screen.queryByText("Missing Architecture")).not.toBeInTheDocument();
    expect(screen.queryByText("Missing Input")).not.toBeInTheDocument();
  });

  test("still allows manual model entry even when a model would be excluded from the catalog", async () => {
    const onAdd = vi.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "vision/filtered-model",
            name: "Filtered Vision",
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["text"],
            },
          },
        ],
      }),
    });

    renderWithMantine(
      <AddModelModal opened onClose={() => {}} onAdd={onAdd} apiKey="test-key" />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText("Filtered Vision")).not.toBeInTheDocument();
    expect(screen.getByText("No models match your search.")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Model ID (e.g. openai/gpt-4o-mini)"), {
      target: { value: "vision/filtered-model" },
    });
    fireEvent.change(screen.getByPlaceholderText("Display name (optional)"), {
      target: { value: "Manual Vision Model" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Model" }));

    expect(onAdd).toHaveBeenCalledWith({
      value: "vision/filtered-model",
      label: "Manual Vision Model",
    });
  });
});
