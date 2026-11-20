import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  query,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Product } from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { NewProductModal } from './NewProductModal';
import { NewComboModal } from './NewComboModal';
import { EditProductModal } from './EditProductModal';
import { DeleteAuthModal } from './DeleteAuthModal';
import { PromocionesTab } from './PromocionesTab';
import {
  Plus,
  Search,
  Trash2,
  Utensils,
  Edit,
  Layers,
  Tag,
} from 'lucide-react';

export const CartaModule: React.FC = () => {
  const [cartaTab, setCartaTab] = useState<'productos' | 'promociones'>('productos');
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isNewProductModalOpen, setIsNewProductModalOpen] = useState(false);
  const [isNewComboModalOpen, setIsNewComboModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const debouncedSearch = useDebouncedValue(searchQuery, 150);

  // Security deletion state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const productToDeleteRef = useRef<Product | null>(null);
  // Real-time listener for Firestore "products" collection
  useEffect(() => {
    const q = query(collection(db, 'products'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Product[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...(docSnap.data() as Omit<Product, 'id'>) });
        });
        setProducts(list);
      },
      (err) => {
        console.error('Error al escuchar colección de productos:', err);
        setDeleteError('No se pudo sincronizar el menú con la base de datos.');
      }
    );

    return () => unsubscribe();
  }, []);

  // Trigger protected deletion modal
  const handleRequestDeleteProduct = useCallback((e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    productToDeleteRef.current = product;
    setProductToDelete(product);
    setDeleteModalOpen(true);
  }, []);

  const handleConfirmDelete = async () => {
    const target = productToDeleteRef.current || productToDelete;
    if (!target) return;
    setDeleteError(null);
    try {
      await deleteDoc(doc(db, 'products', target.id));
    } catch (err: any) {
      console.error('Error al eliminar producto:', err);
      setDeleteError('Error al eliminar producto: ' + (err.message || 'Error de base de datos'));
    } finally {
      productToDeleteRef.current = null;
      setProductToDelete(null);
      setDeleteModalOpen(false);
    }
  };

  // Categories list
  const categories = useMemo(
    () => ['Todos', ...Array.from(new Set(products.map((p) => p.category)))],
    [products]
  );

  const filteredProducts = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return products.filter((p) => {
      const matchesCat = selectedCategory === 'Todos' || p.category === selectedCategory;
      if (!matchesCat) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
    });
  }, [products, selectedCategory, debouncedSearch]);

  return (
    <div className="flex-1 flex flex-col gap-5 relative min-h-[calc(100vh-140px)]">
      {/* Sub-navigation & Horizontal Action Row inside Carta: Carta/Productos + [PROMOCIONES | NUEVO COMBO | NUEVO PLATILLO] */}
      <div className="bg-white border border-gray-200 rounded-2xl p-2.5 shadow-xs flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCartaTab('productos')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
              cartaTab === 'productos'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <Utensils className="w-4 h-4 text-[#E89E2D]" />
            Carta / Productos
          </button>

          {/* 3 botones uno al lado del otro en una sola fila horizontal */}
          <div className="flex items-center gap-2 overflow-x-auto flex-nowrap">
            <button
              type="button"
              onClick={() => setCartaTab('promociones')}
              className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                cartaTab === 'promociones'
                  ? 'bg-[#E89E2D] text-slate-950 shadow-xs ring-2 ring-[#E89E2D]/40'
                  : 'bg-amber-50 hover:bg-amber-100 text-amber-950 border border-[#E89E2D]/50'
              }`}
            >
              <Tag className="w-4 h-4 text-[#D97706] shrink-0" />
              PROMOCIONES
            </button>

            <button
              type="button"
              onClick={() => {
                setCartaTab('productos');
                setIsNewComboModalOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-[#D97706]/40 text-amber-900 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-xs active:scale-95 cursor-pointer shrink-0 whitespace-nowrap"
            >
              <Layers className="w-4 h-4 text-[#D97706] shrink-0" />
              NUEVO COMBO
            </button>

            <button
              type="button"
              onClick={() => {
                setCartaTab('productos');
                setIsNewProductModalOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-xs active:scale-95 cursor-pointer shrink-0 whitespace-nowrap"
            >
              <Plus className="w-4 h-4 text-[#E89E2D] shrink-0" />
              NUEVO PLATILLO
            </button>
          </div>
        </div>

        <span className="text-[11px] font-bold text-gray-500 px-2">
          {cartaTab === 'promociones'
            ? 'Configura Descuentos y 2X1 / 3X2 visibles en Mesas'
            : `${products.length} platillos registrados`}
        </span>
      </div>

      {cartaTab === 'promociones' ? (
        <PromocionesTab products={products} />
      ) : (
        <div className="flex-1 min-w-0 flex flex-col space-y-5">
            {/* Search Bar (Lupa) completamente separada y sola */}
            <div className="bg-white border border-gray-200 rounded-2xl p-3.5 shadow-xs">
              <div className="relative w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar platillo o bebida..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl pl-10 pr-4 py-2.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
                />
              </div>
            </div>

        {deleteError && (
          <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center justify-between">
            <span>{deleteError}</span>
            <button
              type="button"
              onClick={() => setDeleteError(null)}
              className="text-rose-700 font-bold hover:underline ml-3 cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        )}

          {/* Category Horizontal Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((cat) => {
              const isSelected = selectedCategory === cat;
              return (
                <button
                  type="button"
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                    isSelected
                      ? 'bg-[#4A5D23] text-white shadow-xs'
                      : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Product Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 flex-1">
            {filteredProducts.length === 0 ? (
              <div className="col-span-full py-16 text-center bg-white rounded-3xl border border-dashed border-gray-200 p-8">
                <Utensils className="w-12 h-12 text-[#4A5D23] mx-auto mb-3 opacity-60" />
                <h4 className="text-base font-bold text-gray-900">No hay productos en esta categoría</h4>
                <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                  Haz clic en "+ Nuevo Platillo / Producto" para agregar un elemento a tu carta.
                </p>
                <button
                  type="button"
                  onClick={() => setIsNewProductModalOpen(true)}
                  className="mt-4 px-4 py-2 rounded-xl bg-[#4A5D23] text-white text-xs font-bold hover:bg-[#3d4d1d] transition-colors"
                >
                  + Agregar Platillo
                </button>
              </div>
            ) : (
              filteredProducts.map((product) => {
                const isUnavailable = product.available === false;

                return (
                  <div
                    key={product.id}
                    className={`border rounded-3xl overflow-hidden shadow-xs flex flex-col bg-white group relative ${
                      isUnavailable ? 'border-rose-200' : 'border-gray-200'
                    }`}
                  >
                    {isUnavailable && (
                      <span className="absolute top-2.5 right-2.5 z-10 bg-rose-600 text-white font-black text-[10px] uppercase px-2.5 py-1 rounded-full">
                        Agotado
                      </span>
                    )}
                    {/* Action buttons (Editar & Borrar) - ALWAYS VISIBLE */}
                    <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingProduct(product);
                        }}
                        className="px-2.5 py-1 rounded-xl bg-white/95 hover:bg-[#EAF5F0] text-gray-800 hover:text-[#4A5D23] border border-gray-300 flex items-center gap-1 text-[11px] font-bold shadow-md cursor-pointer transition-transform active:scale-95"
                        title="Editar platillo"
                      >
                        <Edit className="w-3.5 h-3.5 text-[#4A5D23]" />
                        <span>Editar</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleRequestDeleteProduct(e, product)}
                        className="w-7 h-7 rounded-xl bg-white/95 hover:bg-rose-50 text-gray-500 hover:text-rose-600 border border-gray-300 flex items-center justify-center shadow-md cursor-pointer transition-transform active:scale-95"
                        title="Eliminar producto de la carta (Requiere clave)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Product Photo Container */}
                    <div className="relative w-full h-36 sm:h-44 bg-gray-100 overflow-hidden">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                          <Utensils className="w-8 h-8 text-[#4A5D23]/40" />
                          <span className="text-[10px] text-gray-400 mt-1">Sin foto</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />
                    </div>

                    {/* Product Details */}
                    <div className="p-3.5 sm:p-4 flex flex-col justify-between flex-1">
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#4A5D23] line-clamp-1">
                            {product.category}
                          </span>
                          {product.isCombo ? (
                            <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 shrink-0">
                              Combo ({product.comboItems?.reduce((a, b) => a + b.quantity, 0) || 0})
                            </span>
                          ) : product.linkedRecipeName ? (
                            <span
                              className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30 truncate max-w-[120px]"
                              title={`Ficha técnica vinculada: ${product.linkedRecipeName}`}
                            >
                              ✓ {product.linkedRecipeName}
                            </span>
                          ) : null}
                        </div>
                        <h4 className="font-bold text-sm sm:text-base text-gray-900 line-clamp-2 mt-0.5 leading-snug">
                          {product.name}
                        </h4>
                        {product.isCombo && product.comboItems && product.comboItems.length > 0 && (
                          <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">
                            Incluye: {product.comboItems.map((ci) => `${ci.quantity}x ${ci.name}`).join(', ')}
                          </p>
                        )}
                        {product.customizations && product.customizations.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                              Personalizable: {product.customizations.map((g) => g.name).join(', ')}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between gap-1.5">
                        <span className="text-base sm:text-lg font-black font-mono text-[#E89E2D]">
                          ${product.price.toFixed(2)}
                        </span>

                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* New Product Modal */}
      <NewProductModal
        isOpen={isNewProductModalOpen}
        onClose={() => setIsNewProductModalOpen(false)}
      />

      {/* New Combo Modal */}
      <NewComboModal
        isOpen={isNewComboModalOpen}
        onClose={() => setIsNewComboModalOpen(false)}
      />

      {/* Edit Product Modal */}
      <EditProductModal
        product={editingProduct}
        isOpen={!!editingProduct}
        onClose={() => setEditingProduct(null)}
      />

      {/* Delete Auth Modal */}
      <DeleteAuthModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setProductToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Eliminar Platillo de la Carta"
        itemDescription={productToDelete ? `el platillo "${productToDelete.name}"` : 'este producto'}
      />

    </div>
  );
};
