import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import {
  EMPTY_ORDER_FORM_ITEM,
  OrderFormFields,
  copiedOrderSiteSelection,
  filterOrderSitesForClient,
  siteSelectionAfterClientChange,
  orderSiteIdForRequest,
} from "@/components/order-form-fields";

describe("shared order form fields", () => {
  beforeAll(() => {
    const matches = Element.prototype.matches;
    Element.prototype.matches = function (selector) {
      if (selector === ":modal" || selector === ":popover-open") return false;
      return matches.call(this, selector);
    };
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);
  afterAll(() => vi.unstubAllGlobals());
  const sites = [
    {
      id: "shop-a",
      name: "Магазин А",
      address: "ул. Первая, 1",
      clientId: "client-1",
    },
    {
      id: "shop-b",
      name: "Магазин Б",
      address: "ул. Вторая, 2",
      clientId: "client-2",
    },
  ];

  function ShopFirstForm() {
    const [clientId, setClientId] = useState("");
    const [siteId, setSiteId] = useState("");
    return <OrderFormFields
      clients={[{ id: "client-1", name: "Юрлицо А" }, { id: "client-2", name: "Юрлицо Б" }]}
      products={[]}
      sites={sites}
      siteId={siteId}
      onSiteChange={setSiteId}
      clientId={clientId}
      onClientChange={(id) => {
        setClientId(id);
        setSiteId(siteSelectionAfterClientChange(siteId, id, sites));
      }}
      items={[{ ...EMPTY_ORDER_FORM_ITEM }]}
      onItemChange={vi.fn()}
      onProductSelect={vi.fn()}
      onAddItem={vi.fn()}
      onRemoveItem={vi.fn()}
      note=""
      onNoteChange={vi.fn()}
    />;
  }

  it("searches all shops by name or address before choosing a client and replaces the legal entity", async () => {
    render(<ShopFirstForm />);
    expect((screen.getByTestId("select-order-client") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("select-order-site"));
    fireEvent.change(screen.getByLabelText("Поиск магазина"), { target: { value: "первая" } });
    await waitFor(() => expect(screen.queryByRole("option", { name: /Магазин Б/ })).toBeNull());
    fireEvent.click(screen.getByRole("option", { name: /Магазин А/ }));
    expect((screen.getByTestId("input-order-auto-client") as HTMLInputElement).value).toBe("Юрлицо А");
    expect((screen.getByTestId("input-order-auto-client") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByTestId("select-order-site").textContent).toContain("Первая, 1");

    fireEvent.click(screen.getByTestId("select-order-site"));
    fireEvent.change(screen.getByLabelText("Поиск магазина"), { target: { value: "магазин б" } });
    fireEvent.click(screen.getByRole("option", { name: /Магазин Б/ }));
    expect((screen.getByTestId("input-order-auto-client") as HTMLInputElement).value).toBe("Юрлицо Б");
    expect(screen.getByTestId("select-order-site").textContent).toContain("Вторая, 2");

    fireEvent.click(screen.getByTestId("select-order-site"));
    fireEvent.click(screen.getByRole("option", { name: "Без привязки к магазину" }));
    expect(screen.queryByTestId("input-order-auto-client")).toBeNull();
    expect((screen.getByTestId("select-order-client") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("select-order-client").textContent).toContain("Выберите клиента");
  });

  it("shows a clear empty result without selecting an arbitrary shop", async () => {
    render(<ShopFirstForm />);
    fireEvent.click(screen.getByTestId("select-order-site"));
    fireEvent.change(screen.getByLabelText("Поиск магазина"), { target: { value: "несуществующий адрес" } });
    await waitFor(() => expect(screen.getByText("Магазины не найдены")).not.toBeNull());
    expect(screen.queryByTestId("input-order-auto-client")).toBeNull();
  });

  it("keeps the regular order product row contract", () => {
    const onItemChange = vi.fn();

    render(
      <OrderFormFields
        clients={[{ id: "client-1", name: "Клиент" }]}
        products={[
          { id: "product-1", name: "Плита", unit: "шт", price: 120 },
        ]}
        clientId="client-1"
        onClientChange={vi.fn()}
        items={[{ ...EMPTY_ORDER_FORM_ITEM }]}
        onItemChange={onItemChange}
        onProductSelect={vi.fn()}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
        note=""
        onNoteChange={vi.fn()}
      />,
    );

    const quantity = screen.getByTestId("input-order-item-quantity-0");
    fireEvent.change(quantity, { target: { value: "3" } });

    expect(screen.getByTestId("select-order-item-product-0")).not.toBeNull();
    expect(onItemChange).toHaveBeenCalledWith(0, { quantity: "3" });
  });

  it("filters shops by legal client and clears an incompatible selection", () => {
    expect(filterOrderSitesForClient(sites, "client-1")).toEqual([sites[0]]);
    expect(
      siteSelectionAfterClientChange("shop-a", "client-2", sites),
    ).toBe("");
    expect(
      siteSelectionAfterClientChange("__none__", "client-2", sites),
    ).toBe("__none__");
  });

  it("copies only a shop belonging to the order client", () => {
    expect(copiedOrderSiteSelection("shop-a", "client-1", sites)).toBe(
      "shop-a",
    );
    expect(copiedOrderSiteSelection("shop-a", "client-2", sites)).toBe("");
    expect(copiedOrderSiteSelection(null, "client-1", sites)).toBe("__none__");
    expect(orderSiteIdForRequest("shop-a")).toBe("shop-a");
    expect(orderSiteIdForRequest("__none__")).toBeNull();
  });

  it("keeps the shop field optional for the locked additional-order form", () => {
    render(
      <OrderFormFields
        clients={[]}
        products={[]}
        clientId="client-1"
        onClientChange={vi.fn()}
        clientLockedName="Клиент"
        sourceLabel="Магазин А — ул. Первая, 1"
        items={[{ ...EMPTY_ORDER_FORM_ITEM }]}
        onItemChange={vi.fn()}
        onProductSelect={vi.fn()}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
        note=""
        onNoteChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("input-order-locked-source")).not.toBeNull();
    expect(screen.queryByTestId("select-order-site")).toBeNull();
  });
});