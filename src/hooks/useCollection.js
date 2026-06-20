import { useEffect, useState, useCallback } from "react";
import {
  collection, onSnapshot, addDoc, updateDoc,
  deleteDoc, doc, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db } from "../firebase";

/**
 * Firestore 컬렉션을 실시간으로 구독하고 CRUD 함수를 반환한다.
 * @param {string} col       컬렉션 이름
 * @param {string|null} sort 정렬 필드 (내림차순). null이면 정렬 없음.
 */
export function useCollection(col, sort = null) {
  const [data, setData]     = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ref = collection(db, col);
    const q   = sort ? query(ref, orderBy(sort, "desc")) : ref;
    const unsub = onSnapshot(q, snap => {
      setData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoaded(true);
    }, err => {
      console.error(`[useCollection:${col}]`, err);
      setLoaded(true);
    });
    return unsub;
  }, [col, sort]);

  const add = useCallback(async (item) => {
    const { id: _id, ...rest } = item;
    await addDoc(collection(db, col), { ...rest, _createdAt: serverTimestamp() });
  }, [col]);

  const update = useCallback(async (item) => {
    const { id, ...rest } = item;
    await updateDoc(doc(db, col, id), rest);
  }, [col]);

  const remove = useCallback(async (id) => {
    await deleteDoc(doc(db, col, id));
  }, [col]);

  return { data, loaded, add, update, remove };
}