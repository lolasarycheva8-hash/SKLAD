import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadFile = vi.fn();
const attachPhoto = vi.fn();
const deletePhotoRequest = vi.fn();
const saveCaptionRequest = vi.fn();
const toast = vi.fn();
const approveAct = vi.fn();
const invalidateQueries = vi.fn();
const refetchQueries = vi.fn();
const setQueryData = vi.fn();
const { downloadFileResponse } = vi.hoisted(() => ({
  downloadFileResponse: vi.fn(),
}));
let deletePhotoMutationOptions: any;
let approveMutationOptions: any;
let addPhotoMutationOptions: any;
let queryCache = new Map<string, unknown>();
let listedPhotos: Array<{
  id: string;
  mimeType: string;
  objectPath: string;
  fileName: string;
  caption?: string | null;
}> = [];

vi.mock("@workspace/object-storage-web", () => ({
  useUpload: () => ({ uploadFile, isUploading: false }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListDeliveriesQueryKey: () => ["deliveries"],
  getListDeliveryPhotosQueryKey: (id: string) => ["delivery-photos", id],
  getListMyDeliveriesQueryKey: () => ["my-deliveries"],
  useAddDeliveryPhoto: (options: any) => {
    addPhotoMutationOptions = options.mutation;
    return {
    isPending: false,
      mutateAsync: async (variables: any) => {
        const data = await attachPhoto(variables);
        addPhotoMutationOptions.onSuccess?.(data, variables);
        return data;
      },
    };
  },
  useDeleteDeliveryPhoto: (options: any) => {
    deletePhotoMutationOptions = options.mutation;
    return {
      isPending: false,
      mutate: (variables: any) => {
        const context = deletePhotoMutationOptions.onMutate?.(variables);
        deletePhotoRequest(variables).then(
          (data: unknown) =>
            deletePhotoMutationOptions.onSuccess?.(data, variables, context),
          (error: unknown) =>
            deletePhotoMutationOptions.onError?.(error, variables, context),
        );
      },
    };
  },
  useListDeliveryPhotos: () => ({ data: listedPhotos, isLoading: false }),
  useUpdateDeliveryPhotoCaption: () => ({
    mutateAsync: saveCaptionRequest,
  }),
  useApproveDeliveryAct: (options: any) => {
    approveMutationOptions = options.mutation;
    return {
      isPending: false,
      mutate: approveAct,
    };
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries,
    refetchQueries,
    setQueryData,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/lib/download-file", () => ({
  downloadFileResponse,
  resolveAppUrl: (path: string) => path,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

import { DeliveryPhotosDialog } from "./delivery-photos-dialog";

describe("DeliveryPhotosDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    queryCache = new Map();
    setQueryData.mockImplementation((queryKey, updater) => {
      const cacheKey = JSON.stringify(queryKey);
      const current = queryCache.get(cacheKey);
      const next =
        typeof updater === "function" ? updater(current) : updater;
      if (next !== undefined) queryCache.set(cacheKey, next);
      return next;
    });
    invalidateQueries.mockResolvedValue(undefined);
    refetchQueries.mockResolvedValue(undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    listedPhotos = [];
    let brokenAttempts = 0;
    uploadFile.mockImplementation(async (file: File) => {
      if (file.name === "broken.pdf" && brokenAttempts++ === 0) {
        throw new Error("temporary upload failure");
      }
      return { objectPath: `/uploads/${file.name}` };
    });
    attachPhoto.mockImplementation(async (variables) => ({
      id: `photo-${variables.data.fileName}`,
      ...variables.data,
    }));
    deletePhotoRequest.mockResolvedValue({});
    saveCaptionRequest.mockImplementation(async ({ id, data }) => ({
      ...listedPhotos.find((photo) => photo.id === id),
      id,
      caption: data.caption,
    }));
    approveMutationOptions = undefined;
    addPhotoMutationOptions = undefined;
  });

  it("закрывает окно только после успешного согласования", async () => {
    let callbacks: any;
    approveAct.mockImplementation((_variables, options) => { callbacks = options; });
    const onOpenChange = vi.fn();
    render(<DeliveryPhotosDialog delivery={{ id: "delivery-1", workflowStatus: "done" } as never} open onOpenChange={onOpenChange} canEdit={false} canApprove />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Согласовать акт" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    act(() => callbacks.onSuccess());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("оставляет окно открытым при ошибке согласования", async () => {
    approveAct.mockImplementation((_variables, callbacks) => callbacks.onError(new Error("Не удалось сохранить")));
    const onOpenChange = vi.fn();
    render(<DeliveryPhotosDialog delivery={{ id: "delivery-1", workflowStatus: "done" } as never} open onOpenChange={onOpenChange} canEdit={false} canApprove />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Согласовать акт" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });

  it("показывает объект и фактическую дату в окне просмотра", () => {
    render(<DeliveryPhotosDialog delivery={{ id: "delivery-1", siteName: "Сельвина", siteAddress: "Москва, Тестовая улица, 12", actualDate: "2026-10-02" } as never} open onOpenChange={vi.fn()} canEdit />);
    expect(screen.getByText("Объект: Сельвина")).not.toBeNull();
    expect(screen.getByText("Адрес: Москва, Тестовая улица, 12")).not.toBeNull();
    expect(screen.getByText("Фактическая дата доставки: 02.10.2026")).not.toBeNull();
  });

  it("не подставляет плановую дату вместо отсутствующей фактической", () => {
    render(<DeliveryPhotosDialog delivery={{ id: "delivery-1", siteName: "Объект", plannedDate: "2026-10-02", actualDate: null } as never} open onOpenChange={vi.fn()} canEdit />);
    expect(screen.getByText("Фактическая дата доставки: Не указана")).not.toBeNull();
    expect(screen.getByText("Адрес: Не указан")).not.toBeNull();
  });

  it("подтверждает дату только по явной кнопке вместе с выбранным актом", async () => {
    const user = userEvent.setup();
    render(<DeliveryPhotosDialog delivery={{ id: "delivery-1", actualDate: null, plannedDate: "2026-09-10", workflowStatus: "planned" } as any}
      open onOpenChange={vi.fn()} canEdit allowConfirmCompletion />);
    fireEvent.change(screen.getByLabelText("Фактическая дата доставки"), { target: { value: "2026-09-11" } });
    await user.upload(screen.getByLabelText("Выбрать файл"), new File(["pdf"], "act.pdf", { type: "application/pdf" }));
    expect(uploadFile).not.toHaveBeenCalled();
    expect(attachPhoto).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Подтвердить доставку и загрузить акт" }));
    await waitFor(() => expect(attachPhoto).toHaveBeenCalledWith({
      id: "delivery-1",
      data: { objectPath: "/uploads/act.pdf", fileName: "act.pdf", mimeType: "application/pdf", confirmedActualDate: "2026-09-11" },
    }));
    await waitFor(() => expect(screen.queryByLabelText("Фактическая дата доставки")).toBeNull());
  });

  it("подписывает отдельные PDF и фото, очищает пустую подпись без перезагрузки общего списка", async () => {
    listedPhotos = [
      { id: "pdf-1", fileName: "один.pdf", mimeType: "application/pdf", objectPath: "/objects/one", caption: null },
      { id: "image-2", fileName: "два.jpg", mimeType: "image/jpeg", objectPath: "/objects/two", caption: "Открывашка" },
    ];
    queryCache.set(JSON.stringify(["delivery-photos", "delivery-1"]), listedPhotos);
    const user = userEvent.setup();
    render(<DeliveryPhotosDialog delivery={{ id: "delivery-1" } as never} open onOpenChange={vi.fn()} canEdit />);
    await user.click(screen.getByRole("button", { name: "Добавить подпись" }));
    await user.type(screen.getByLabelText("Подпись акта один.pdf"), "  Допы Коробочка  ");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(saveCaptionRequest).toHaveBeenCalledWith({ id: "pdf-1", data: { caption: "Допы Коробочка" } }));
    await waitFor(() => expect(queryCache.get(JSON.stringify(["delivery-photos", "delivery-1"]))).toEqual([
      { ...listedPhotos[0], caption: "Допы Коробочка" },
      listedPhotos[1],
    ]));
    await user.click(screen.getByRole("button", { name: "Изменить подпись" }));
    await user.clear(screen.getByLabelText("Подпись акта два.jpg"));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(saveCaptionRequest).toHaveBeenLastCalledWith({ id: "image-2", data: { caption: null } }));
    await waitFor(() => expect(queryCache.get(JSON.stringify(["delivery-photos", "delivery-1"]))).toEqual([
      { ...listedPhotos[0], caption: "Допы Коробочка" },
      { ...listedPhotos[1], caption: null },
    ]));
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(refetchQueries).not.toHaveBeenCalled();
  });

  it("сохраняет ошибку только в карточке и не переносит её при переключении доставки", async () => {
    listedPhotos = [{ id: "photo-1", fileName: "акт.pdf", mimeType: "application/pdf", objectPath: "/objects/one" }];
    saveCaptionRequest.mockRejectedValueOnce({ data: { error: "Нет прав изменять акты этой доставки" } });
    const user = userEvent.setup();
    const { rerender } = render(<DeliveryPhotosDialog delivery={{ id: "delivery-1" } as never} open onOpenChange={vi.fn()} canEdit />);
    await user.click(screen.getByRole("button", { name: "Добавить подпись" }));
    await user.type(screen.getByLabelText("Подпись акта акт.pdf"), "Химия");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Нет прав изменять акты");
    rerender(<DeliveryPhotosDialog delivery={{ id: "delivery-2" } as never} open onOpenChange={vi.fn()} canEdit />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByDisplayValue("Химия")).toBeNull();
  });

  it("запоздалое сохранение меняет только кэш исходной доставки", async () => {
    listedPhotos = [{ id: "photo-1", fileName: "акт.pdf", mimeType: "application/pdf", objectPath: "/objects/one" }];
    queryCache.set(JSON.stringify(["delivery-photos", "delivery-1"]), listedPhotos);
    queryCache.set(JSON.stringify(["delivery-photos", "delivery-2"]), [{ ...listedPhotos[0], caption: "Другая" }]);
    let resolveSave!: (value: unknown) => void;
    saveCaptionRequest.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    const user = userEvent.setup();
    const { rerender } = render(<DeliveryPhotosDialog delivery={{ id: "delivery-1" } as never} open onOpenChange={vi.fn()} canEdit />);
    await user.click(screen.getByRole("button", { name: "Добавить подпись" }));
    await user.type(screen.getByLabelText("Подпись акта акт.pdf"), "Коробочка");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    rerender(<DeliveryPhotosDialog delivery={{ id: "delivery-2" } as never} open onOpenChange={vi.fn()} canEdit />);
    await act(async () => resolveSave({ ...listedPhotos[0], caption: "Коробочка" }));
    expect(queryCache.get(JSON.stringify(["delivery-photos", "delivery-1"]))).toEqual([{ ...listedPhotos[0], caption: "Коробочка" }]);
    expect(queryCache.get(JSON.stringify(["delivery-photos", "delivery-2"]))).toEqual([{ ...listedPhotos[0], caption: "Другая" }]);
    expect(screen.queryByDisplayValue("Коробочка")).toBeNull();
  });

  it("после трёх загрузок обновляет каждый общий список и список актов ровно один раз", async () => {
    const user = userEvent.setup();
    render(
      <DeliveryPhotosDialog
        delivery={{ id: "delivery-1" } as never}
        open
        onOpenChange={vi.fn()}
        canEdit
      />,
    );

    await user.upload(screen.getByLabelText("Выбрать файл"), [
      new File(["1"], "one.pdf", { type: "application/pdf" }),
      new File(["2"], "two.pdf", { type: "application/pdf" }),
      new File(["3"], "three.pdf", { type: "application/pdf" }),
    ]);

    await waitFor(() => expect(attachPhoto).toHaveBeenCalledTimes(3));
    expect(refetchQueries).toHaveBeenCalledTimes(1);
    expect(refetchQueries).toHaveBeenCalledWith({
      queryKey: ["delivery-photos", "delivery-1"],
      exact: true,
      type: "all",
    });
    expect(
      invalidateQueries.mock.calls.filter(
        ([options]) => options.queryKey[0] === "deliveries",
      ),
    ).toHaveLength(1);
    expect(
      invalidateQueries.mock.calls.filter(
        ([options]) => options.queryKey[0] === "my-deliveries",
      ),
    ).toHaveLength(1);
  });

  it("при частичном результате обновляет общие списки только один раз", async () => {
    attachPhoto.mockImplementation(async (variables) => {
      if (variables.data.fileName === "failed.pdf") {
        throw new Error("attach failed");
      }
      return { id: "photo-added", ...variables.data };
    });
    const user = userEvent.setup();
    render(
      <DeliveryPhotosDialog
        delivery={{ id: "delivery-1" } as never}
        open
        onOpenChange={vi.fn()}
        canEdit
      />,
    );

    await user.upload(screen.getByLabelText("Выбрать файл"), [
      new File(["ok"], "added.pdf", { type: "application/pdf" }),
      new File(["bad"], "failed.pdf", { type: "application/pdf" }),
    ]);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Загрузка завершена частично" }),
      ),
    );
    expect(refetchQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("при неоднозначной ошибке прикрепления без успехов консервативно обновляет данные", async () => {
    attachPhoto.mockRejectedValue(new Error("response lost after attach"));
    const user = userEvent.setup();
    render(
      <DeliveryPhotosDialog
        delivery={{ id: "delivery-1" } as never}
        open
        onOpenChange={vi.fn()}
        canEdit
      />,
    );

    await user.upload(
      screen.getByLabelText("Выбрать файл"),
      new File(["maybe"], "ambiguous.pdf", { type: "application/pdf" }),
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Не удалось загрузить акты" }),
      ),
    );
    expect(screen.getByText("response lost after attach")).not.toBeNull();
    expect(refetchQueries).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("показывает причину отказа сервера рядом с неудачным файлом", async () => {
    attachPhoto.mockRejectedValue({
      data: { error: "Разрешены только PDF и изображения" },
      message: "Request failed with status 400",
    });
    const user = userEvent.setup();
    render(
      <DeliveryPhotosDialog delivery={{ id: "delivery-1" } as never} open onOpenChange={vi.fn()} canEdit />,
    );
    await user.upload(
      screen.getByLabelText("Выбрать файл"),
      new File(["photo"], "image.jpg", { type: "image/jpeg" }),
    );
    expect(await screen.findByText("Разрешены только PDF и изображения")).not.toBeNull();
    expect(screen.queryByText("Request failed with status 400")).toBeNull();
  });

  it("после переключения диалога обновляет кэш актов исходной доставки", async () => {
    let finishAttach!: (photo: {
      id: string;
      objectPath: string;
      fileName: string;
      mimeType: string;
    }) => void;
    attachPhoto.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishAttach = resolve;
        }),
    );
    queryCache.set(
      JSON.stringify(["delivery-photos", "delivery-1"]),
      [{
        id: "existing-1",
        objectPath: "/uploads/existing-1.pdf",
        fileName: "existing-1.pdf",
        mimeType: "application/pdf",
      }],
    );
    queryCache.set(
      JSON.stringify(["delivery-photos", "delivery-2"]),
      [{
        id: "existing-2",
        objectPath: "/uploads/existing-2.pdf",
        fileName: "existing-2.pdf",
        mimeType: "application/pdf",
      }],
    );
    const user = userEvent.setup();
    const commonProps = {
      open: true,
      onOpenChange: vi.fn(),
      canEdit: true,
    };
    const { rerender } = render(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{ id: "delivery-1" } as never}
      />,
    );

    await user.upload(
      screen.getByLabelText("Выбрать файл"),
      new File(["old"], "old.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => expect(attachPhoto).toHaveBeenCalledOnce());
    rerender(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{ id: "delivery-2" } as never}
      />,
    );

    finishAttach({
      id: "attached-1",
      objectPath: "/uploads/old.pdf",
      fileName: "old.pdf",
      mimeType: "application/pdf",
    });

    await waitFor(() => expect(refetchQueries).toHaveBeenCalledOnce());
    expect(
      (queryCache.get(
        JSON.stringify(["delivery-photos", "delivery-1"]),
      ) as Array<{ id: string }>).map((photo) => photo.id),
    ).toEqual(["existing-1", "attached-1"]);
    expect(
      (queryCache.get(
        JSON.stringify(["delivery-photos", "delivery-2"]),
      ) as Array<{ id: string }>).map((photo) => photo.id),
    ).toEqual(["existing-2"]);
    expect(refetchQueries).toHaveBeenCalledWith({
      queryKey: ["delivery-photos", "delivery-1"],
      exact: true,
      type: "all",
    });
  });

  it("задаёт кнопкам действий безопасный тип и не отправляет внешнюю форму", () => {
    listedPhotos = [{
      id: "photo-1",
      mimeType: "application/pdf",
      objectPath: "/uploads/act.pdf",
      fileName: "act.pdf",
    }];
    render(
      <form>
        <DeliveryPhotosDialog
          delivery={{ id: "delivery-1", workflowStatus: "done" } as never}
          open
          onOpenChange={vi.fn()}
          canEdit
          canApprove
        />
      </form>,
    );

    expect(screen.getByRole("button", { name: "Удалить акт act.pdf" }).getAttribute("type")).toBe("button");
    expect(screen.getByLabelText("Сделать снимок").closest("button")?.getAttribute("type")).toBe("button");
    expect(screen.getByLabelText("Выбрать файл").closest("button")?.getAttribute("type")).toBe("button");
    expect(screen.getByRole("button", { name: "Согласовать акт" }).getAttribute("type")).toBe("button");
  });

  it("при повторе отправляет только неудачный акт и не прикрепляет успешный повторно", async () => {
    const user = userEvent.setup();
    render(
      <DeliveryPhotosDialog
        delivery={{ id: "delivery-1" } as never}
        open
        onOpenChange={vi.fn()}
        canEdit
      />,
    );

    const addedFile = new File(["added"], "added.pdf", {
      type: "application/pdf",
    });
    const failedFile = new File(["broken"], "broken.pdf", {
      type: "application/pdf",
    });

    await user.upload(screen.getByLabelText("Выбрать файл"), [
      addedFile,
      failedFile,
    ]);

    await screen.findByText("broken.pdf");
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(attachPhoto).toHaveBeenCalledTimes(1);
    expect(attachPhoto).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fileName: "added.pdf" }),
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Повторить неудачные" }),
    );

    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(attachPhoto).toHaveBeenCalledTimes(2));

    expect(uploadFile.mock.calls.map(([file]) => file.name)).toEqual([
      "added.pdf",
      "broken.pdf",
      "broken.pdf",
    ]);
    expect(
      attachPhoto.mock.calls.map(([variables]) => variables.data.fileName),
    ).toEqual(["added.pdf", "broken.pdf"]);
  });

  it("скачивает ZIP всех актов текущей доставки", async () => {
    listedPhotos = [
      {
        id: "photo-1",
        mimeType: "application/pdf",
        objectPath: "/uploads/act.pdf",
        fileName: "act.pdf",
      },
    ];
    downloadFileResponse.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <DeliveryPhotosDialog
        delivery={{ id: "delivery-1" } as never}
        open
        onOpenChange={vi.fn()}
        canEdit={false}
        canDownload
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Скачать все акты" }),
    );

    await waitFor(() =>
      expect(downloadFileResponse).toHaveBeenCalledWith(
        "/api/deliveries/delivery-1/acts/download",
        "акты-доставки-delivery-1.zip",
      ),
    );
  });

  it("показывает отдельные нативные ссылки для просмотра и скачивания акта", async () => {
    listedPhotos = [
      {
        id: "photo-1",
        mimeType: "application/pdf",
        objectPath: "/objects/delivery-1/act.pdf",
        fileName: "акт поставки.pdf",
      },
    ];

    render(
      <DeliveryPhotosDialog
        delivery={{ id: "delivery-1" } as never}
        open
        onOpenChange={vi.fn()}
        canEdit={false}
        canDownload
      />,
    );

    const viewLink = screen.getByRole("link", {
      name: "Открыть акт акт поставки.pdf",
    });
    const downloadLink = screen.getByRole("link", {
      name: "Скачать акт акт поставки.pdf",
    });

    expect(viewLink.getAttribute("href")).toBe(
      "/api/storage/objects/delivery-1/act.pdf",
    );
    expect(downloadLink.getAttribute("href")).toBe(
      "/api/storage/objects/delivery-1/act.pdf?download=1",
    );
    expect(downloadLink.getAttribute("download")).toBe("акт поставки.pdf");
  });

  it("понятно сообщает об отсутствующем объекте и не предлагает просмотр или скачивание", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, { status: 404 }),
    );
    listedPhotos = [
      {
        id: "photo-missing",
        mimeType: "application/pdf",
        objectPath: "/objects/delivery-1/missing.pdf",
        fileName: "старый акт.pdf",
      },
    ];

    render(
      <DeliveryPhotosDialog
        delivery={{ id: "delivery-1" } as never}
        open
        onOpenChange={vi.fn()}
        canEdit={false}
        canDownload
      />,
    );

    expect(
      await screen.findByText(
        "Файл отсутствует в хранилище. Просмотр и скачивание недоступны.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Скачать акт старый акт.pdf" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Открыть акт старый акт.pdf" }),
    ).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "/api/storage/objects/delivery-1/missing.pdf",
      { method: "HEAD", credentials: "same-origin" },
    );
  });

  it("при ошибке предпросмотра существующего изображения сохраняет просмотр и скачивание", async () => {
    listedPhotos = [
      {
        id: "photo-heic",
        mimeType: "image/heic",
        objectPath: "/objects/delivery-1/photo.heic",
        fileName: "фото.heic",
      },
    ];

    render(
      <DeliveryPhotosDialog
        delivery={{ id: "delivery-1" } as never}
        open
        onOpenChange={vi.fn()}
        canEdit={false}
        canDownload
      />,
    );

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/storage/objects/delivery-1/photo.heic",
        { method: "HEAD", credentials: "same-origin" },
      ),
    );
    fireEvent.error(screen.getByRole("img", { name: "фото.heic" }));

    expect(
      await screen.findByText("Предпросмотр недоступен — откройте файл отдельно"),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Открыть акт фото.heic" })
        .getAttribute("href"),
    ).toBe("/api/storage/objects/delivery-1/photo.heic");
    expect(
      screen
        .getByRole("link", { name: "Скачать акт фото.heic" })
        .getAttribute("href"),
    ).toBe(
      "/api/storage/objects/delivery-1/photo.heic?download=1",
    );
    expect(
      screen.queryByTestId("status-delivery-act-missing-photo-heic"),
    ).toBeNull();
  });

  it("не показывает запоздалый результат и уведомление после закрытия диалога", async () => {
    let finishUpload!: (value: { objectPath: string }) => void;
    uploadFile.mockImplementation(
      () =>
        new Promise<{ objectPath: string }>((resolve) => {
          finishUpload = resolve;
        }),
    );
    const user = userEvent.setup();
    const props = {
      delivery: { id: "delivery-1" } as never,
      onOpenChange: vi.fn(),
      canEdit: true,
    };
    const { rerender } = render(
      <DeliveryPhotosDialog {...props} open />,
    );

    await user.upload(
      screen.getByLabelText("Выбрать файл"),
      new File(["late"], "late.pdf", { type: "application/pdf" }),
    );
    expect(uploadFile).toHaveBeenCalledOnce();

    rerender(<DeliveryPhotosDialog {...props} open={false} />);
    finishUpload({ objectPath: "/uploads/late.pdf" });

    await waitFor(() => expect(attachPhoto).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByText("Результат загрузки")).toBeNull(),
    );
    expect(screen.queryByText("late.pdf")).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("не показывает запоздалую ошибку удаления после закрытия диалога", async () => {
    let rejectDelete!: (reason: Error) => void;
    deletePhotoRequest.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectDelete = reject;
        }),
    );
    listedPhotos = [
      {
        id: "photo-1",
        mimeType: "application/pdf",
        objectPath: "/uploads/act.pdf",
        fileName: "act.pdf",
      },
    ];
    const user = userEvent.setup();
    const props = {
      delivery: { id: "delivery-1" } as never,
      onOpenChange: vi.fn(),
      canEdit: true,
    };
    const { rerender } = render(
      <DeliveryPhotosDialog {...props} open />,
    );

    await user.click(
      screen.getByRole("button", { name: "Удалить акт act.pdf" }),
    );
    expect(deletePhotoRequest).toHaveBeenCalledWith({ id: "photo-1" });

    rerender(<DeliveryPhotosDialog {...props} open={false} />);
    rejectDelete(new Error("late delete failure"));

    await waitFor(() => expect(deletePhotoRequest).toHaveBeenCalledOnce());
    expect(toast).not.toHaveBeenCalled();
  });

  it("при 404 обновляет акты и показывает нейтральное уведомление", async () => {
    deletePhotoRequest.mockRejectedValue({ status: 404 });
    listedPhotos = [
      {
        id: "photo-1",
        mimeType: "application/pdf",
        objectPath: "/uploads/act.pdf",
        fileName: "act.pdf",
      },
    ];
    const user = userEvent.setup();
    render(
      <DeliveryPhotosDialog
        delivery={{ id: "delivery-1" } as never}
        open
        onOpenChange={vi.fn()}
        canEdit
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Удалить акт act.pdf" }),
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Акт уже удалён",
        description: "Список актов обновлён: файл удалил другой администратор.",
      }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["delivery-photos", "delivery-1"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["deliveries"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["my-deliveries"],
    });
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("настоящую ошибку удаления оставляет красной и не обновляет список", async () => {
    deletePhotoRequest.mockRejectedValue({
      status: 500,
      data: { error: "Хранилище недоступно" },
    });
    listedPhotos = [
      {
        id: "photo-1",
        mimeType: "application/pdf",
        objectPath: "/uploads/act.pdf",
        fileName: "act.pdf",
      },
    ];
    const user = userEvent.setup();
    render(
      <DeliveryPhotosDialog
        delivery={{ id: "delivery-1" } as never}
        open
        onOpenChange={vi.fn()}
        canEdit
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Удалить акт act.pdf" }),
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Ошибка",
        description: "Хранилище недоступно",
        variant: "destructive",
      }),
    );
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("сохраняет блокировку загрузки при возврате к обрабатываемой доставке", async () => {
    let finishFirstUpload!: (value: { objectPath: string }) => void;
    uploadFile.mockImplementation(
      () =>
        new Promise<{ objectPath: string }>((resolve) => {
          finishFirstUpload = resolve;
        }),
    );
    const user = userEvent.setup();
    const commonProps = {
      open: true,
      onOpenChange: vi.fn(),
      canEdit: true,
    };
    const { rerender } = render(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{ id: "delivery-1" } as never}
      />,
    );

    await user.upload(
      screen.getByLabelText("Выбрать файл"),
      new File(["pending"], "pending.pdf", { type: "application/pdf" }),
    );
    expect(uploadFile).toHaveBeenCalledOnce();
    expect(
      (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
    ).toBe(true);

    rerender(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{ id: "delivery-2" } as never}
      />,
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
      ).toBe(false),
    );

    rerender(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{ id: "delivery-1" } as never}
      />,
    );
    expect(
      (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Сделать снимок") as HTMLInputElement).disabled,
    ).toBe(true);

    finishFirstUpload({ objectPath: "/uploads/pending.pdf" });

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByLabelText("Сделать снимок") as HTMLInputElement).disabled,
    ).toBe(false);
  });

  it("разблокирует доставку после ошибки фоновой загрузки и не переносит результат на другую", async () => {
    let rejectFirstUpload!: (reason: Error) => void;
    uploadFile.mockImplementation(
      () =>
        new Promise<{ objectPath: string }>((_resolve, reject) => {
          rejectFirstUpload = reject;
        }),
    );
    const user = userEvent.setup();
    const commonProps = {
      open: true,
      onOpenChange: vi.fn(),
      canEdit: true,
    };
    const { rerender } = render(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{ id: "delivery-1" } as never}
      />,
    );

    await user.upload(
      screen.getByLabelText("Выбрать файл"),
      new File(["broken"], "broken-background.pdf", {
        type: "application/pdf",
      }),
    );
    expect(uploadFile).toHaveBeenCalledOnce();
    expect(
      (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
    ).toBe(true);

    rerender(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{ id: "delivery-2" } as never}
      />,
    );
    expect(
      (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
    ).toBe(false);
    expect(screen.queryByText("broken-background.pdf")).toBeNull();

    rerender(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{ id: "delivery-1" } as never}
      />,
    );
    expect(
      (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
    ).toBe(true);

    await act(async () => {
      rejectFirstUpload(new Error("object storage unavailable"));
    });

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByLabelText("Сделать снимок") as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "LI" &&
          element.textContent?.startsWith("Не добавлен: broken-background.pdf") === true,
      ),
    ).not.toBeNull();

    rerender(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{ id: "delivery-2" } as never}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByText("broken-background.pdf")).toBeNull(),
    );
    expect(
      (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
    ).toBe(false);
  });

  it("сохраняет блокировку загрузки после ухода со страницы и возврата", async () => {
    let finishUpload!: (value: { objectPath: string }) => void;
    uploadFile.mockImplementation(
      () =>
        new Promise<{ objectPath: string }>((resolve) => {
          finishUpload = resolve;
        }),
    );
    const user = userEvent.setup();
    const props = {
      delivery: { id: "delivery-1" } as never,
      open: true,
      onOpenChange: vi.fn(),
      canEdit: true,
    };
    const firstPage = render(<DeliveryPhotosDialog {...props} />);

    await user.upload(
      screen.getByLabelText("Выбрать файл"),
      new File(["pending"], "pending.pdf", { type: "application/pdf" }),
    );
    expect(uploadFile).toHaveBeenCalledOnce();
    expect(
      (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
    ).toBe(true);

    firstPage.unmount();
    render(<DeliveryPhotosDialog {...props} />);

    expect(
      (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Сделать снимок") as HTMLInputElement).disabled,
    ).toBe(true);
    await user.upload(
      screen.getByLabelText("Выбрать файл"),
      new File(["duplicate"], "duplicate.pdf", { type: "application/pdf" }),
    );
    expect(uploadFile).toHaveBeenCalledOnce();

    finishUpload({ objectPath: "/uploads/pending.pdf" });
    await waitFor(() => expect(attachPhoto).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
      ).toBe(false),
    );
  });

  it("разрешает загрузку новой доставки и не смешивает завершения операций", async () => {
    const pendingUploads = new Map<
      string,
      {
        resolve: (value: { objectPath: string }) => void;
        reject: (reason: Error) => void;
      }
    >();
    uploadFile.mockImplementation(
      (file: File) =>
        new Promise<{ objectPath: string }>((resolve, reject) => {
          pendingUploads.set(file.name, { resolve, reject });
        }),
    );
    const user = userEvent.setup();
    const commonProps = {
      open: true,
      onOpenChange: vi.fn(),
      canEdit: true,
    };
    const { rerender } = render(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{ id: "delivery-1" } as never}
      />,
    );

    await user.upload(
      screen.getByLabelText("Выбрать файл"),
      new File(["old"], "old-delivery.pdf", { type: "application/pdf" }),
    );
    expect(uploadFile).toHaveBeenCalledOnce();

    rerender(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{ id: "delivery-2" } as never}
      />,
    );

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Выбрать файл") as HTMLInputElement).disabled,
      ).toBe(false),
    );
    await user.upload(
      screen.getByLabelText("Выбрать файл"),
      new File(["new"], "new-delivery.pdf", { type: "application/pdf" }),
    );
    expect(uploadFile).toHaveBeenCalledTimes(2);

    pendingUploads.get("old-delivery.pdf")?.reject(new Error("late upload failure"));
    await waitFor(() => expect(toast).not.toHaveBeenCalled());

    pendingUploads
      .get("new-delivery.pdf")
      ?.resolve({ objectPath: "/uploads/new-delivery.pdf" });
    await screen.findByText("new-delivery.pdf");

    await screen.findByText("Результат загрузки");
    expect(screen.queryByText("old-delivery.pdf")).toBeNull();
    expect(screen.getByText("new-delivery.pdf")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Повторить неудачные" }),
    ).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Все акты добавлены" }),
    );
    expect(
      attachPhoto.mock.calls.map(([variables]) => variables.id),
    ).toEqual(["delivery-2"]);
  });

  it.each([
    {
      title:
        "не закрывает окно другой доставки из-за запоздалого подтверждения",
      nextDeliveryId: "delivery-2",
    },
    {
      title:
        "не закрывает новый цикл той же доставки из-за запоздалого подтверждения",
      nextDeliveryId: "delivery-1",
    },
  ])("$title", async ({ nextDeliveryId }) => {
    let finishApproval!: () => void;
    approveAct.mockImplementation((variables, callbacks) => {
      finishApproval = () => {
        approveMutationOptions.onSuccess({}, variables);
        callbacks?.onSuccess?.({}, variables);
      };
    });
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const commonProps = {
      open: true,
      onOpenChange,
      canEdit: false,
      canApprove: true,
    };
    const { rerender } = render(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{
          id: "delivery-1",
          workflowStatus: "done",
        } as never}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Согласовать акт" }),
    );
    expect(approveAct).toHaveBeenCalledWith(
      { id: "delivery-1" },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );

    rerender(
      <DeliveryPhotosDialog
        {...commonProps}
        open={false}
        delivery={{
          id: "delivery-1",
          workflowStatus: "done",
        } as never}
      />,
    );
    rerender(
      <DeliveryPhotosDialog
        {...commonProps}
        delivery={{
          id: nextDeliveryId,
          workflowStatus: "done",
        } as never}
      />,
    );

    act(() => finishApproval());

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(2));
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["deliveries"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["my-deliveries"],
    });
    expect(toast).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Согласовать акт" }),
    ).toBeTruthy();
  });
});
