"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Barcode,
  CircleDollarSign,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";

type Branch = {
  id: string;
  name: string;
  organization: { taxRate: string; currency: string };
};
type StockItem = {
  id: string;
  stockAvailable: number;
  localPrice: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    category: string;
    basePrice: string;
  };
};
type CartLine = {
  product: StockItem["product"];
  quantity: number;
  price: number;
  maxStock: number;
};
type Sale = { id: string; invoiceNumber: string; totalAmount: string };
const money = (value: number, currency = "COP") =>
  formatCurrency(value, currency);

export default function PosPage() {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState("");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<Branch[]>("/branches"),
  });
  const selectedBranch = branchId || branches.data?.[0]?.id || "";
  const inventory = useQuery({
    queryKey: ["inventory", selectedBranch],
    queryFn: () => api<StockItem[]>(`/inventory?branchId=${selectedBranch}`),
    enabled: Boolean(selectedBranch),
  });
  const checkout = useMutation({
    mutationFn: () =>
      api<Sale>("/sales", {
        method: "POST",
        body: JSON.stringify({
          branchId: selectedBranch,
          paymentMethod,
          items: cart.map(({ product, quantity }) => ({
            productId: product.id,
            quantity,
          })),
        }),
      }),
    onSuccess: async (sale) => {
      setCart([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
      ]);
      try {
        const pdf = await api<Blob>(`/receipts/${sale.id}.pdf`);
        const url = URL.createObjectURL(pdf);
        const link = document.createElement("a");
        link.href = url;
        link.download = `comprobante-${sale.invoiceNumber}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      } catch {}
    },
  });
  const visibleItems =
    inventory.data?.filter((item) =>
      `${item.product.name} ${item.product.sku}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  const add = (item: StockItem) =>
    setCart((current) => {
      const currentLine = current.find(
        (line) => line.product.id === item.product.id,
      );
      if (currentLine)
        return current.map((line) =>
          line.product.id === item.product.id
            ? { ...line, quantity: Math.min(line.maxStock, line.quantity + 1) }
            : line,
        );
      return item.stockAvailable > 0
        ? [
            ...current,
            {
              product: item.product,
              quantity: 1,
              price: Number(item.localPrice ?? item.product.basePrice),
              maxStock: item.stockAvailable,
            },
          ]
        : current;
    });
  const subtotal = cart.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0,
  );
  const taxRate = Number(
    branches.data?.find((branch) => branch.id === selectedBranch)?.organization
      .taxRate ?? 0,
  );
  const tax = subtotal * taxRate;
  const currency =
    branches.data?.find((branch) => branch.id === selectedBranch)?.organization
      .currency ?? "COP";

  return (
    <div className="pos-page">
      <section className="page-heading pos-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> CAJA
          </div>
          <h1>
            Punto de <em>venta.</em>
          </h1>
          <p className="page-subtitle">
            Escanea, agrega al carrito y cierra la venta.
          </p>
        </div>
        <label className="branch-filter">
          <span>SEDE ACTIVA</span>
          <select
            value={selectedBranch}
            onChange={(event) => setBranchId(event.target.value)}
          >
            {branches.data?.map((branch) => (
              <option value={branch.id} key={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="pos-workspace">
        <div className="catalog-panel">
          <div className="catalog-toolbar">
            <div className="catalog-title">
              <span className="catalog-kicker">CATÁLOGO</span>
              <strong>
                Productos disponibles <small>{visibleItems.length}</small>
              </strong>
            </div>
            <label className="search-field">
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nombre o código SKU"
              />
              <Barcode size={17} />
            </label>
          </div>
          <div className="product-grid">
            {visibleItems.map((item, index) => (
              <button
                key={item.id}
                className="product-tile"
                onClick={() => add(item)}
                disabled={!item.stockAvailable}
              >
                <span className={`product-tile-mark mark-${index % 4}`}>
                  <ShoppingBag size={20} />
                </span>
                <span className="product-tile-category">
                  {item.product.category}
                </span>
                <strong>{item.product.name}</strong>
                <span className="product-tile-bottom">
                  <b>
                    {money(Number(item.localPrice ?? item.product.basePrice), currency)}
                  </b>
                  <small>{item.stockAvailable} disponibles</small>
                </span>
              </button>
            ))}
            {!visibleItems.length && (
              <div className="empty-state">
                {inventory.isLoading
                  ? "Cargando productos…"
                  : "No hay productos para mostrar."}
              </div>
            )}
          </div>
        </div>
        <aside className="cart-panel">
          <div className="cart-head">
            <div>
              <span className="catalog-kicker">VENTA ACTUAL</span>
              <h2>Carrito</h2>
            </div>
            <span className="cart-count">
              {cart
                .reduce((sum, line) => sum + line.quantity, 0)
                .toString()
                .padStart(2, "0")}
            </span>
          </div>
          <div className="cart-lines">
            {cart.map((line) => (
              <div className="cart-line" key={line.product.id}>
                <div className="cart-line-info">
                  <strong>{line.product.name}</strong>
                  <small>{money(line.price, currency)} c/u</small>
                  <div className="qty-control">
                    <button
                      aria-label="Disminuir"
                      onClick={() =>
                        setCart((current) =>
                          current.flatMap((item) =>
                            item.product.id !== line.product.id
                              ? [item]
                              : item.quantity > 1
                                ? [{ ...item, quantity: item.quantity - 1 }]
                                : [],
                          ),
                        )
                      }
                    >
                      <Minus size={13} />
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      aria-label="Aumentar"
                      onClick={() =>
                        setCart((current) =>
                          current.map((item) =>
                            item.product.id === line.product.id
                              ? { ...item, quantity: item.quantity + 1 }
                              : item,
                          ),
                        )
                      }
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
                <div className="cart-line-end">
                  <strong>{money(line.quantity * line.price, currency)}</strong>
                  <button
                    className="icon-quiet"
                    aria-label="Quitar del carrito"
                    onClick={() =>
                      setCart((current) =>
                        current.filter(
                          (item) => item.product.id !== line.product.id,
                        ),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            {cart.length === 0 && (
              <div className="cart-empty">
                <span>
                  <ShoppingBag size={23} />
                </span>
                <strong>Tu carrito está vacío</strong>
                <small>Selecciona productos del catálogo para iniciar.</small>
              </div>
            )}
          </div>
          <div className="cart-summary">
            <div>
              <span>Subtotal</span>
              <strong>{money(subtotal, currency)}</strong>
            </div>
            <div>
              <span>IVA estimado</span>
              <strong>{money(tax, currency)}</strong>
            </div>
            <div className="cart-total">
              <span>Total</span>
              <strong>{money(subtotal + tax, currency)}</strong>
            </div>
            <label className="payment-select">
              <span>FORMA DE PAGO</span>
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
              >
                <option value="CASH">Efectivo</option>
                <option value="CARD">Tarjeta</option>
                <option value="TRANSFER">Transferencia</option>
              </select>
            </label>
            <button
              className="primary-button checkout-button"
              onClick={() => checkout.mutate()}
              disabled={!cart.length || !selectedBranch || checkout.isPending}
            >
              <CircleDollarSign size={18} />
              {checkout.isPending ? "Procesando…" : "Cobrar"}
              <span>{money(subtotal + tax, currency)}</span>
            </button>
            {checkout.isError && (
              <div className="inline-error">{checkout.error.message}</div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
