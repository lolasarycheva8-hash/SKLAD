import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CreatableSiteLookup } from "@/components/creatable-site-lookup";

Object.assign(HTMLElement.prototype, {
  hasPointerCapture: () => false,
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
  scrollIntoView: () => {},
});

afterEach(cleanup);

it("не сбрасывает новый вариант из-за пустого события скрытого select внутри формы", () => {
  function ControlledForm() {
    const [value, setValue] = useState("Старый куст");
    return (
      <form>
        <CreatableSiteLookup
          id="site-branch"
          label="Куст"
          value={value}
          options={["Старый куст"]}
          onChange={setValue}
        />
        <button type="button" onClick={() => setValue("Новый куст")}>Подставить новый</button>
      </form>
    );
  }

  const { container } = render(<ControlledForm />);
  fireEvent.click(screen.getByRole("button", { name: "Подставить новый" }));
  const nativeSelect = container.querySelector("select")!;
  expect(nativeSelect).toBeTruthy();
  fireEvent.change(nativeSelect, { target: { value: "" } });
  expect(screen.getByTestId("select-site-branch").textContent).toContain("Новый куст");
});

async function choose(option: string) {
  fireEvent.keyDown(screen.getByTestId("select-site-branch"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
  const optionNode = screen.getByRole("option", { name: option });
  fireEvent.keyDown(optionNode, { key: "Enter", code: "Enter" });
}

it("отображает controlled value и меняет его при выборе существующего варианта", async () => {
  const user = userEvent.setup();

  function ControlledLookup() {
    const [value, setValue] = useState("Текущий куст");
    return (
      <CreatableSiteLookup
        id="site-branch"
        label="Куст"
        value={value}
        options={["Другой куст", "Текущий куст"]}
        onChange={setValue}
      />
    );
  }

  render(<ControlledLookup />);
  expect(screen.getByTestId("select-site-branch").textContent).toContain(
    "Текущий куст",
  );

  await choose("Другой куст");
  expect(screen.getByTestId("select-site-branch").textContent).toContain(
    "Другой куст",
  );
});

it("сохраняет черновик при ошибке создания и позволяет повторить", async () => {
  const user = userEvent.setup();
  let rejectFirst!: (error: Error) => void;
  const firstAttempt = new Promise<string>((_resolve, reject) => {
    rejectFirst = reject;
  });
  const onCreate = vi
    .fn()
    .mockImplementationOnce(() => firstAttempt)
    .mockResolvedValueOnce("Созданный куст");
  const onChange = vi.fn();

  render(
    <CreatableSiteLookup
      id="site-branch"
      label="Куст"
      value=""
      options={["Существующий куст"]}
      onChange={onChange}
      onCreate={onCreate}
    />,
  );

  await choose("Создать новый");
  const input = screen.getByTestId("input-new-site-branch") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "  Черновик куста  " } });
  fireEvent.click(screen.getByTestId("button-create-site-branch"));
  await waitFor(() =>
    expect(
      (screen.getByTestId("button-create-site-branch") as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  expect((screen.getByTestId("input-new-site-branch") as HTMLInputElement).disabled).toBe(
    true,
  );

  rejectFirst(new Error("Не удалось создать куст"));
  expect(await screen.findByText("Не удалось создать куст")).toBeTruthy();
  expect((screen.getByTestId("input-new-site-branch") as HTMLInputElement).value).toBe(
    "  Черновик куста  ",
  );
  expect(
    (screen.getByTestId("button-create-site-branch") as HTMLButtonElement).disabled,
  ).toBe(false);

  fireEvent.click(screen.getByTestId("button-create-site-branch"));
  await waitFor(() =>
    expect(onCreate).toHaveBeenCalledWith("Черновик куста"),
  );
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith("Созданный куст"),
  );
  expect(screen.queryByTestId("input-new-site-branch")).toBeNull();
});

it("показывает ошибку загрузки и повторяет запрос по кнопке", async () => {
  const user = userEvent.setup();
  const onRetry = vi.fn();

  render(
    <CreatableSiteLookup
      id="site-branch"
      label="Куст"
      value=""
      options={[]}
      onChange={vi.fn()}
      isError
      onRetry={onRetry}
    />,
  );

  expect(screen.getByRole("alert").textContent).toContain(
    "Не удалось загрузить список.",
  );
  expect((screen.getByTestId("select-site-branch") as HTMLButtonElement).disabled).toBe(
    true,
  );
  await user.click(screen.getByRole("button", { name: "Повторить" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("не вызывает API для выбора, совпадающего с существующим без учета регистра", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn();
  const onChange = vi.fn();

  render(
    <CreatableSiteLookup
      id="site-branch"
      label="Куст"
      value=""
      options={["Северный куст"]}
      onChange={onChange}
      onCreate={onCreate}
    />,
  );

  await choose("Создать новый");
  fireEvent.change(screen.getByTestId("input-new-site-branch"), { target: { value: "  северный куст  " } });
  fireEvent.click(screen.getByTestId("button-create-site-branch"));

  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith("Северный куст"),
  );
  expect(onCreate).not.toHaveBeenCalled();
});