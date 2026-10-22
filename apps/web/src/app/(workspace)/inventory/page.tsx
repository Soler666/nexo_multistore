"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowDown, ArrowUp, Boxes, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, parseCurrencyInput } from "@/lib/currency";

type InventoryRow = {
  id: string;
  stockAvailable: number;
  minStockAlert: number;
  localPrice: string | null;
  isLowStock: boolean;
  product: {
    id: string;
    name: string;
    sku: string;
    category: string;
    basePrice: string;
  };
  branch: { name: string; organization: { currency: string } };
};
type Branch = {
  id: string;
  name: string;
  businessType: string;
  organization: { currency: string };
};
type InventoryResponse = {
  data: InventoryRow[];
  page: number;
  pageSize: number;
  total: number;
};
type CurrentUser = { id: string; role: string };
export default function InventoryPage() {
  const client = useQueryClient();
  const [branchId, setBranchId] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showProductForm, setShowProductForm] = useState(false);
  const [priceError, setPriceError] = useState("");
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<CurrentUser>("/auth/me"),
  });
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<Branch[]>("/branches"),
  });
  const inventory = useQuery({
    queryKey: ["inventory", branchId, businessType, search, page],
    queryFn: () =>
      api<InventoryResponse>(
        `/inventory?${new URLSearchParams({ page: String(page), pageSize: "20", ...(branchId ? { branchId } : {}), ...(businessType ? { businessType } : {}), ...(search ? { search } : {}) })}`,
      ),
  });
  const adjust = useMutation({
    mutationFn: ({ id, delta }: { id: string; delta: number }) =>
      api(`/inventory/${id}/adjust`, {
        method: "PATCH",
        body: JSON.stringify({
          delta,
          reason:
            delta > 0 ? "Reabastecimiento manual" : "Ajuste de inventario",
        }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["inventory"] }),
  });
  const addProduct = useMutation({
    mutationFn: (payload: Record<string, string | number>) =>
      api("/inventory/products", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["inventory"] });
      setShowProductForm(false);
      setPriceError("");
    },
  });
  const archiveProduct = useMutation({
    mutationFn: (productId: string) =>
      api(`/inventory/products/${productId}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["inventory"] }),
  });
  function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      setPriceError("");
      addProduct.mutate({
        branchId: values.get("branchId") as string,
        sku: values.get("sku") as string,
        name: values.get("name") as string,
        category: values.get("category") as string,
        basePrice: parseCurrencyInput(
          String(values.get("basePrice")),
          currency,
        ),
        initialStock: Number(values.get("initialStock")),
        minStockAlert: Number(values.get("minStockAlert")),
      });
    } catch (error) {
      setPriceError(
        error instanceof Error ? error.message : "Precio no válido",
      );
    }
  }
  const critical =
    inventory.data?.data.filter((item) => item.isLowStock).length ?? 0;
  const businessTypes = [
    ...new Set(branches.data?.map((branch) => branch.businessType) ?? []),
  ];
  const currency = branches.data?.[0]?.organization.currency ?? "COP";
  const money = (value: number) => formatCurrency(value, currency);

  return (
    <div className="inventory-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> CONTROL DE EXISTENCIAS
          </div>
          <h1>
            Inventario<span className="heading-comma">.</span>
          </h1>
          <p className="page-subtitle">
            Cada producto, cada sede, una vista actualizada.
          </p>
        </div>
        <div className="inventory-heading-stats">
          <span>
            <b>{inventory.data?.total ?? "—"}</b> referencias
          </span>
          <i />
          <span className="critical-stat">
            <b>{critical}</b> por reponer en página
          </span>
        </div>
      </section>
      <section className="inventory-toolbar">
        <label className="search-field inventory-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Buscar por producto o SKU"
          />
        </label>
        <div className="inventory-actions">
          <label className="branch-filter">
            <span>SEDE</span>
            <select
              value={branchId}
              onChange={(event) => {
                setBranchId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas las sedes</option>
              {branches.data?.map((branch) => (
                <option value={branch.id} key={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
            <span className="select-chevron">⌄</span>
          </label>
          <label className="branch-filter">
            <span>TIPO DE NEGOCIO</span>
            <select
              value={businessType}
              onChange={(event) => {
                setBusinessType(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos los tipos</option>
              {businessTypes.map((type) => (
                <option value={type} key={type}>
                  {type}
                </option>
              ))}
            </select>
            <span className="select-chevron">⌄</span>
          </label>
          <button
            className="primary-button add-product-button"
            onClick={() => setShowProductForm((open) => !open)}
          >
            <Plus size={15} /> Producto
          </button>
        </div>
      </section>
      {showProductForm && (
        <form className="product-create-form" onSubmit={submitProduct}>
          <label>
            Sede
            <select name="branchId" required defaultValue="">
              <option value="" disabled>
                Selecciona sede
              </option>
              {branches.data?.map((branch) => (
                <option value={branch.id} key={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nombre
            <input name="name" required maxLength={160} />
          </label>
          <label>
            SKU
            <input name="sku" required maxLength={80} />
          </label>
          <label>
            Categoría
            <input name="category" required maxLength={100} />
          </label>
          <label>
            Precio ({currency})
            <input
              name="basePrice"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={currency === "COP" ? "25.000" : "25,000.00"}
              required
              onChange={() => setPriceError("")}
            />
          </label>
          <label>
            Stock inicial
            <input
              name="initialStock"
              type="number"
              min="0"
              step="1"
              defaultValue="0"
              required
            />
          </label>
          <label>
            Alerta mínima
            <input
              name="minStockAlert"
              type="number"
              min="0"
              step="1"
              defaultValue="5"
              required
            />
          </label>
          <button className="primary-button" disabled={addProduct.isPending}>
            {addProduct.isPending ? "Guardando…" : "Guardar producto"}
          </button>
          {priceError && <span className="inline-error">{priceError}</span>}
          {addProduct.isError && (
            <span className="inline-error">{addProduct.error.message}</span>
          )}
        </form>
      )}
      <section className="table-panel">
        <div className="table-topline">
          <div>
            <Boxes size={17} />
            <strong>Stock por sede</strong>
          </div>
          <span>ACTUALIZACIÓN EN VIVO</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>PRODUCTO</th>
                <th>SKU</th>
                <th>SEDE</th>
                <th>PRECIO</th>
                <th>DISPONIBLE</th>
                <th>MÍNIMO</th>
                <th>ESTADO</th>
                <th>AJUSTE</th>
                {session.data?.role === "STORE_OWNER" && <th>CATÁLOGO</th>}
              </tr>
            </thead>
            <tbody>
              {inventory.data?.data.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.product.name}</strong>
                    <small>{item.product.category}</small>
                  </td>
                  <td className="sku-cell">{item.product.sku}</td>
                  <td>{item.branch.name}</td>
                  <td>
                    {money(Number(item.localPrice ?? item.product.basePrice))}
                  </td>
                  <td>
                    <strong
                      className={item.stockAvailable === 0 ? "stock-zero" : ""}
                    >
                      {item.stockAvailable}
                    </strong>
                  </td>
                  <td>{item.minStockAlert}</td>
                  <td>
                    <span
                      className={`status-pill ${item.isLowStock ? "status-warning" : "status-ok"}`}
                    >
                      <i />
                      {item.stockAvailable === 0
                        ? "Agotado"
                        : item.isLowStock
                          ? "Stock bajo"
                          : "Disponible"}
                    </span>
                  </td>
                  <td>
                    <div className="adjust-controls">
                      <button
                        aria-label="Aumentar stock"
                        disabled={adjust.isPending}
                        onClick={() => adjust.mutate({ id: item.id, delta: 1 })}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        aria-label="Disminuir stock"
                        disabled={adjust.isPending || item.stockAvailable === 0}
                        onClick={() =>
                          adjust.mutate({ id: item.id, delta: -1 })
                        }
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </td>
                  {session.data?.role === "STORE_OWNER" && (
                    <td>
                      <button
                        className="archive-action"
                        aria-label={`Retirar ${item.product.name} del catálogo`}
                        title="Retirar del catálogo sin borrar el historial"
                        disabled={archiveProduct.isPending}
                        onClick={() => {
                          if (window.confirm(`¿Retirar ${item.product.name} del catálogo? Las ventas históricas se conservarán.`)) {
                            archiveProduct.mutate(item.product.id);
                          }
                        }}
                      >
                        <Archive size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!inventory.data?.data.length && (
                <tr>
                  <td colSpan={session.data?.role === "STORE_OWNER" ? 9 : 8} className="table-empty">
                    {inventory.isLoading
                      ? "Cargando inventario…"
                      : "No se encontraron productos."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {adjust.isError && (
          <div className="notice error table-notice">
            {adjust.error.message}
          </div>
        )}
        {archiveProduct.isError && (
          <div className="notice error table-notice">{archiveProduct.error.message}</div>
        )}
        <div className="table-bottomline">
          <span>Umbral de bajo stock configurado por producto.</span>
          <div className="table-paging">
            <span>{inventory.data?.total ?? 0} registros</span>
            <button
              className="secondary-button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </button>
            <span>{page}</span>
            <button
              className="secondary-button"
              disabled={
                page * (inventory.data?.pageSize ?? 20) >=
                (inventory.data?.total ?? 0)
              }
              onClick={() => setPage(page + 1)}
            >
              Siguiente
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
