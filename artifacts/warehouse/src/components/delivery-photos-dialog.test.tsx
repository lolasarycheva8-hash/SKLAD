import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadFile = vi.fn();
const attachPhoto = vi.fn();
const deletePhotoRequest = vi.fn();
const toast = vi.fn();
const approveAct = vi.fn();
const invalidateQueries = vi.fn();
const { downloadFileResponse } = vi.hoisted(() => ({
  downloadFileResponse: vi.fn(),
}));
let deletePhotoMutationOptions: any;
let approveMutationOptions: any;
let listedPhotos: Array<{
  id: string;
  mimeType: string;
  objectPath: string;
  fileName: string;
}> = [];

vi.mock("@workspace/object-storage-web", () => ({
  useUpload: () => ({ uploadFile, isUploading: false }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListDeliveriesQueryKey: () => ["deliveries"],
  getListDeliveryPhotosQueryKey: (id: string) => ["delivery-photos", id],
  getListMyDeliveriesQueryKey: () => ["my-deliveries"],
  useAddDeliveryPhoto: () => ({
    isPending: false,
    mutateAsync: attachPhoto,
  }),
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
    setQueryData: vi.fn(),
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
}));

import { DeliveryPhotosDialog } from "./delivery-photos-dialog";

describe("DeliveryPhotosDialog", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    listedPhotos = [];
    let brokenAttempts = 0;
    uploadFile.mockImplementation(async (file: File) => {
      if (file.name === "broken.pdf" && brokenAttempts++ === 0) {
        throw new Error("temporary upload failure");
      }
      return { objectPath: `/uploads/${file.name}` };
    });
    attachPhoto.mockResolvedValue({});
    deletePhotoRequest.mockResolvedValue({});
    approveMutationOptions = undefined;
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

    await user.click(screen.getByRole("button", { name: "" }));
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

    await user.click(screen.getByRole("button", { name: "" }));

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

    await user.click(screen.getByRole("button", { name: "" }));

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
          element.textContent === "Не добавлен: broken-background.pdf",
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
      screen.getByRole("button", { name: "Подтвердить акты" }),
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
      screen.getByRole("button", { name: "Подтвердить акты" }),
    ).toBeTruthy();
  });
});
