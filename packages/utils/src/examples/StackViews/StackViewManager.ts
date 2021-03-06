import {putResolve, put} from 'redux-saga/effects';
import {AnyClass, InsTyp, createSelf, Self, State, createState, PrototypeArray, Saga} from 'redux-anno';
import {BaseViewItem} from './ViewItem';

export class BaseStackViewManager<T extends BaseViewItem = BaseViewItem, C extends AnyClass = AnyClass<T>> {
  @State current = createState<number>(-1);
  @State items = createState<InsTyp<C>[]>([]);
  @State isAdding = createState<boolean>(false);
  @State isRemoving = createState<boolean>(false);

  @Self mgrSelf = createSelf(BaseStackViewManager);

  itemInstances: PrototypeArray<T>;

  constructor() {
    this.itemInstances = new PrototypeArray(this.mgrSelf.contextName);
  }
  *onPageAdded(_ins: InsTyp<AnyClass<T>>): Generator<any, any, any> {
    return;
  }
  *onPageRemoved(_ins: InsTyp<AnyClass<T>>): Generator<any, any, any> {
    return;
  }

  get length(): number {
    return this.mgrSelf.items.value.length;
  }

  @Saga()
  *add(pl: {model: AnyClass<T>; args: ConstructorParameters<AnyClass<T>>}) {
    yield putResolve(this.mgrSelf.isAdding.create(true));
    const newLen = this.itemInstances.push([pl.model, pl.args]);
    const theIns = this.itemInstances.insArr[newLen - 1];
    yield* theIns.initialize();
    yield this.onPageAdded(theIns);
    yield putResolve(this.mgrSelf.isAdding.create(false));
    yield putResolve(this.mgrSelf.items.create([...this.itemInstances.insArr]));
    return;
  }

  @Saga()
  *remove(pl: {index: number; force?: boolean}) {
    let removed = 0;
    const {index, force} = pl;
    if (index >= 0 && index < this.itemInstances.insArr.length) {
      yield putResolve(this.mgrSelf.isRemoving.create(true));
      const theIns = this.itemInstances.insArr[pl.index];
      const shouldClose = yield* theIns.shouldClose(force);
      if (!!shouldClose) {
        yield* theIns.close();
        const nextItems = [...this.itemInstances.insArr];
        nextItems.splice(index, 1);
        yield put(this.mgrSelf.items.create(nextItems));
        this.itemInstances.splice(index, 1);
        yield* this.onPageRemoved(theIns);
        removed++;
        // set current if needed
        const curVal = this.mgrSelf.current.value;
        const curLen = this.length;
        if (curVal === index || curVal >= curLen) {
          yield putResolve(this.mgrSelf.current.create(curVal - 1));
        }
      }
      yield putResolve(this.mgrSelf.isRemoving.create(false));
    }
    return removed;
  }

  @Saga()
  *removeUntil(pl: {index: number; force?: boolean}) {
    const {index, force} = pl;
    let removed = 0;
    const target = index < 0 ? -1 : index;
    if (target >= -1 && target < this.itemInstances.insArr.length) {
      while (this.itemInstances.insArr.length - 1 > target) {
        const oneRemoved = yield* this.remove({index: this.itemInstances.insArr.length - 1, force});
        if (!oneRemoved) {
          return removed;
        }
        removed += removed;
      }
    }
    return removed;
  }
  /**
   * clean all items and add the new item
   */
  @Saga()
  *clearAndAdd<M extends AnyClass<T>>(pl: {model: M; args: ConstructorParameters<M>; force?: boolean}) {
    yield* this.removeUntil({index: 0, force: pl.force});
    yield* this.add(pl);
    yield putResolve(this.mgrSelf.items.create([...this.itemInstances.insArr]));
  }

  /**
   * reset the stack to the current item, clean all items after it before adding the new item
   */
  @Saga()
  *navigateTo<M extends AnyClass<T>>(pl: {model: M; args: ConstructorParameters<M>; force?: boolean}) {
    const cur = this.mgrSelf.current.value;
    const {force} = pl;
    yield* this.removeUntil({
      index: cur,
      force,
    });
    yield* this.add(pl);
    yield putResolve(this.mgrSelf.items.create([...this.itemInstances.insArr]));
    return;
  }

  /**
   * reset the stack to the previous item, clean all items after it before adding the new item
   */
  @Saga()
  *redirectTo<M extends AnyClass<T>>(pl: {model: M; args: ConstructorParameters<M>; force?: boolean}) {
    const cur = this.mgrSelf.current.value;
    const {force} = pl;
    yield* this.removeUntil({
      index: cur - 1,
      force,
    });
    yield* this.add(pl);
    yield putResolve(this.mgrSelf.items.create([...this.itemInstances.insArr]));
    return;
  }
}
