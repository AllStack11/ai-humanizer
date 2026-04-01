import { fireEvent, render, screen } from "@testing-library/react";
import { createTheme, MantineProvider } from "@mantine/core";
import WritingProfileModal from "./WritingProfileModal.jsx";

const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "lg",
  fontFamily: "Manrope, Inter, system-ui, sans-serif",
});

function renderWithMantine(ui) {
  return render(<MantineProvider theme={theme}>{ui}</MantineProvider>);
}

describe("WritingProfileModal", () => {
  test("renders all traits and edit controls even when values are empty", () => {
    renderWithMantine(
      <WritingProfileModal
        profile={{ humor: "dry" }}
        health={null}
        profileLabel="Personal"
        hasProfile
        confidence={{}}
        meta={null}
        onUpdateMeta={null}
        onUpdateProfile={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText("Tone")).not.toBeInTheDocument();
    expect(screen.queryByText("Formality")).not.toBeInTheDocument();
    expect(screen.getByText("Humor")).toBeInTheDocument();
    expect(screen.getByText("Transition Style")).toBeInTheDocument();
    expect(screen.getByText("dry")).toBeInTheDocument();
    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Edit Humor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Transition Style" })).toBeInTheDocument();
  });

  test("saving an empty trait keeps the row visible and persists an empty string", () => {
    const onUpdateProfile = vi.fn();

    renderWithMantine(
      <WritingProfileModal
        profile={{ humor: "dry" }}
        health={null}
        profileLabel="Personal"
        hasProfile
        confidence={{}}
        meta={null}
        onUpdateMeta={null}
        onUpdateProfile={onUpdateProfile}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Humor" }));
    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Humor" }));

    expect(onUpdateProfile).toHaveBeenCalledWith({ humor: "" });
    expect(screen.getByText("Humor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Humor" })).toBeInTheDocument();
  });
});
