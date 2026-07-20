import { db } from '../firebase';
import { collection, doc, addDoc, updateDoc, onSnapshot, query, orderBy } from 'firebase/firestore';

const accountsCol = collection(db, 'attendance_accounts');

// 문서 데이터 자체에 로그인 id 필드가 있어서, Firestore 문서 id는 별도로 uid로 내려준다.
export function subscribeAccounts(cb) {
  return onSnapshot(query(accountsCol, orderBy('name')), (snap) => {
    cb(snap.docs.map((d) => ({ ...d.data(), uid: d.id })));
  });
}

export function createAccount({ id, pw, name, role }) {
  return addDoc(accountsCol, { id: id.trim(), pw, name: name.trim(), role, active: true });
}

export function setAccountActive(uid, active) {
  return updateDoc(doc(accountsCol, uid), { active });
}
