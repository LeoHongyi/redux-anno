import {Store} from 'redux';
import {ImdAnnoConstructor, AsImdAnnoInst, ThunkPromiseHandler, MODEL_TYPE, MODEL_NAME_FIELD} from './base';
import {AnyAction, registerActionHelper, unregisterActionHelper} from './action';
import {AnnoStoreOptions} from './store';
import {ModelReducer} from './reducer';
import {InstancedConstructor, InsTyp} from './instanced';
import {CyclicPrototypeInstanceFound, ModelNotFound, InstanceNotFound} from './errors';
import {AnyClass, Nullable} from './utils';
import toposort from './utils/toposort';

const ACTION_NAME_SEPARATOR = 'Æ';

export interface ModelConstructors<M> {
  modelConstructor: AnyClass<M>;
  instancedConstructor: InstancedConstructor<AnyClass<M>> | any;
}

interface IModelMeta<M> {
  type: MODEL_TYPE;
  name: string;
  modelConstructor: AnyClass<M>;
  reducersByFieldName: Map<string, ModelReducer>;
}

export class ModelMeta<M> implements IModelMeta<M>, ModelConstructors<M> {
  public readonly type: MODEL_TYPE;
  public readonly name: string;

  // todo type of ImdAnnoConstructor instead ?
  public readonly modelConstructor: AnyClass<M>;
  public readonly instancedConstructor: InstancedConstructor<AnyClass<M>> | any;
  public readonly reducersByFieldName: Map<string, ModelReducer>;

  constructor(
    type: MODEL_TYPE,
    name: string,
    modelConstructor: AnyClass<M>,
    instancedConstructor: ImdAnnoConstructor<any>
  ) {
    this.type = type;
    this.name = name;
    this.modelConstructor = modelConstructor;
    this.instancedConstructor = instancedConstructor;
    this.reducersByFieldName = new Map<string, ModelReducer>();
  }
}

export class DelegateModelMetaInContext<M> implements IModelMeta<M> {
  public get type(): MODEL_TYPE {
    return this.modelMeta.type;
  }
  public get name(): string {
    return this.modelMeta.name;
  }
  public get modelConstructor(): ImdAnnoConstructor<AnyClass<M>> {
    return this.modelMeta.modelConstructor as ImdAnnoConstructor<AnyClass<M>>;
  }
  public get reducersByFieldName(): Map<string, ModelReducer> {
    return this.modelMeta.reducersByFieldName;
  }

  public singletonInstance?: InsTyp<AnyClass<M>>;
  public instancesByKey: Map<string, InsTyp<any>>;

  constructor(private readonly modelMeta: ModelMeta<M>) {
    this.instancesByKey = new Map();
  }
}

export function withAnnoContext<T extends AnyClass>(PreWrappedModel: T, contextName: string): T {
  const ModelWithReduxContextName = function (this: T) {
    const self = this as AsImdAnnoInst<T>;
    self.contextName = contextName;
    // eslint-disable-next-line prefer-rest-params
    PreWrappedModel.apply(this, arguments as any);
  };
  ModelWithReduxContextName.prototype = PreWrappedModel.prototype;
  return (ModelWithReduxContextName as unknown) as T;
}

export class AnnoContext {
  public readonly name: string;
  private readonly ctxMgr: AnnoContextManager;

  constructor(ctxMgr: AnnoContextManager, name: string) {
    this.ctxMgr = ctxMgr;
    this.name = name;
  }

  // general section
  public store: Store;
  public options: AnnoStoreOptions;

  public rootState: any;

  public readonly assembleActionName = assembleActionName;
  public readonly disassembleActionName = disassembleActionName;

  private metaDelegatesByModel: Map<AnyClass, DelegateModelMetaInContext<any>> = new Map();
  private cachedInstancedConstructor: Map<AnyClass, InstancedConstructor<AnyClass> | any> = new Map();
  public registerModel<Model extends AnyClass>(
    constructor: Model,
    instancedConstructor: InstancedConstructor<Model>,
    modelMeta: ModelMeta<InstanceType<Model>>
  ): void {
    this.ctxMgr.registerModel(constructor, instancedConstructor, modelMeta);
    this.metaDelegatesByModel.set(constructor, new DelegateModelMetaInContext(modelMeta));
  }
  public getModelConstructors<M>(modelOrName: string | AnyClass<M>): Nullable<ModelConstructors<M>> {
    const result = this.ctxMgr.getModelConstructors(modelOrName);
    if (!!this.name && result) {
      if (!this.cachedInstancedConstructor.has(result.modelConstructor)) {
        this.cachedInstancedConstructor.set(
          result.modelConstructor,
          withAnnoContext(result.instancedConstructor, this.name)
        );
      }
      return {
        modelConstructor: result.modelConstructor,
        instancedConstructor: this.cachedInstancedConstructor.get(result.modelConstructor),
      };
    }
    return result;
  }
  public getModelMeta<M>(model: AnyClass<M> | string): Nullable<DelegateModelMetaInContext<M>> {
    let modelConstructor: Nullable<AnyClass>;
    if (typeof model === 'string') {
      modelConstructor = this.ctxMgr.getModelConstructors(model)?.modelConstructor;
    } else {
      modelConstructor = model;
    }

    if (!!modelConstructor) {
      if (this.metaDelegatesByModel.has(modelConstructor)) {
        return this.metaDelegatesByModel.get(modelConstructor);
      }
      // need to create the delegate context
      const modelMeta = this.ctxMgr.getModelMeta(modelConstructor);
      if (!!modelMeta) {
        const modelMetaDelegate: DelegateModelMetaInContext<M> = new DelegateModelMetaInContext(modelMeta);
        this.metaDelegatesByModel.set(modelConstructor, modelMetaDelegate);
        return modelMetaDelegate;
      }
    }

    return undefined;
  }
  public getAllModelMeta(): DelegateModelMetaInContext<unknown>[] {
    const results: DelegateModelMetaInContext<any>[] = [];
    for (const [, modelMeta] of this.metaDelegatesByModel) {
      results.push(modelMeta);
    }
    return results;
  }
  public getInstanceConstructor<C extends AnyClass>(modelOrName: string | C): Nullable<InstancedConstructor<C>> {
    return this.getModelConstructors(modelOrName)?.instancedConstructor;
  }

  // Instance section
  private instanceMap: Map<string, AsImdAnnoInst<any>> = new Map();
  private static buildInstancePath(modelName: string, key?: string): string {
    return !!key ? `${modelName}${ACTION_NAME_SEPARATOR}${key}` : modelName;
  }
  public addOneInstance(instance: AsImdAnnoInst<any>): void {
    const theModelPath = AnnoContext.buildInstancePath(instance.modelName, instance.modelKey);
    const theModelMeta = this.getModelMeta(instance.modelName);
    if (this.instanceMap.has(theModelPath)) {
      // todo need to reconsider the instance removing sequences
      throw new Error(`Cannot add the new instance to the path ${theModelPath}; consider to remove it first`);
    } else if (!theModelMeta) {
      throw new Error(`Cannot find the model for the name of ${instance.modelName}`);
    }

    if (theModelMeta.type === MODEL_TYPE.SINGLETON) {
      theModelMeta.singletonInstance = instance;
    } else {
      if (!instance.modelKey) {
        throw new Error(`Cannot find the key of the instance belonging to ${theModelPath}`);
      } else {
        theModelMeta.instancesByKey.set(instance.modelKey, instance);
      }
    }
    this.instanceMap.set(theModelPath, instance);
  }
  public clearInstanceMap(): void {
    this.getAllModelMeta().forEach((oneMeta) => {
      oneMeta.singletonInstance = void 0;
      oneMeta.instancesByKey.clear();
    });
    this.instanceMap.clear();
  }
  public removeOneInstance(modelName: string, key?: string): AsImdAnnoInst<any> {
    const theModelPath = AnnoContext.buildInstancePath(modelName, key);
    if (!this.instanceMap.has(theModelPath)) {
      throw new Error(`Cannot find the instance of the path ${theModelPath}`);
    }
    const theInstanceTobeRemoved = this.instanceMap.get(theModelPath);
    const theModelMeta = this.getModelMeta(modelName);
    if (!!key) {
      theModelMeta!.instancesByKey.delete(key);
    } else {
      theModelMeta!.singletonInstance = void 0;
    }
    this.instanceMap.delete(theModelPath);
    return theInstanceTobeRemoved;
  }
  public getOneInstance<Model extends AnyClass>(
    modelOrName: string | Model,
    key?: string
  ): InstanceType<InstancedConstructor<ImdAnnoConstructor<Model>>> {
    const modelMeta = this.getModelMeta(modelOrName);
    if (!!modelMeta) {
      const theModelPath = AnnoContext.buildInstancePath(modelMeta.name, key);
      if (!this.instanceMap.has(theModelPath)) {
        throw new InstanceNotFound(`Cannot find the instance of the path ${theModelPath}`);
      }
      return this.instanceMap.get(theModelPath);
    } else {
      throw new Error(`Cannot find the model of ${modelOrName}`);
    }
  }

  // Thunk Action
  public thunkPromiseByAction: WeakMap<AnyAction, ThunkPromiseHandler> = new WeakMap();

  // prototype instance graph
  private prototypeInstanceGraph: Array<[string, string]> = [];
  private lastValidatedPrototypeInstanceGraphSize: number = this.prototypeInstanceGraph.length;
  public addPrototypeInstanceEdge(source: string, target: string): void {
    this.prototypeInstanceGraph.push([source, target]);
  }
  public validateCyclicPrototypeInstances(): void {
    if (this.lastValidatedPrototypeInstanceGraphSize !== this.prototypeInstanceGraph.length) {
      try {
        toposort(this.prototypeInstanceGraph);
        this.lastValidatedPrototypeInstanceGraphSize = this.prototypeInstanceGraph.length;
      } catch (e) {
        throw new CyclicPrototypeInstanceFound(e.message, this.prototypeInstanceGraph);
      }
    }
  }
}

class AnnoContextManager {
  static ANNO_CTX_MGR = new AnnoContextManager();

  constructor() {
    if (!!AnnoContextManager.ANNO_CTX_MGR) {
      // internal err, no need throw a wrapped one
      throw new Error('Cannot create multiple AnnoContextManagers');
    }
  }

  // Model section
  private metaByModel: Map<AnyClass, ModelMeta<any>> = new Map();
  private constructorsByModelName: Map<string, ModelConstructors<any>> = new Map();
  public registerModel<Model extends AnyClass>(
    modelConstructor: Model,
    instancedConstructor: InstancedConstructor<Model>,
    modelMeta: ModelMeta<InstanceType<Model>>
  ) {
    if (!this.metaByModel.has(modelConstructor) && !this.constructorsByModelName.has(modelMeta.name)) {
      this.constructorsByModelName.set(modelMeta.name, {modelConstructor, instancedConstructor});
      this.metaByModel.set(modelConstructor, modelMeta);
    } else {
      throw new Error('Try to register duplicated model: ' + modelMeta.name);
    }
  }
  public getModelConstructors<Model extends AnyClass>(
    modelOrName: string | Model
  ): Nullable<ModelConstructors<InstanceType<Model>>> {
    let result;
    if (typeof modelOrName === 'string') {
      result = this.constructorsByModelName.get(modelOrName);
    } else if (this.metaByModel.has(modelOrName as AnyClass)) {
      result = this.constructorsByModelName.get(this.getModelMeta(modelOrName)!.name);
    }
    return result;
  }
  public getModelMeta<M>(model: AnyClass<M> | string): Nullable<ModelMeta<M>> {
    if (typeof model === 'string') {
      const constructors = this.constructorsByModelName.get(model);
      return !!constructors ? this.metaByModel.get(constructors.modelConstructor) : undefined;
    } else {
      return this.metaByModel.get(model);
    }
  }
  public getAllModelMeta(): ModelMeta<unknown>[] {
    const result: ModelMeta<any>[] = [];
    for (const [, modelMeta] of this.metaByModel) {
      result.push(modelMeta);
    }
    return result;
  }
  public getInstanceConstructor<Model extends AnyClass>(
    modelOrName: string | Model
  ): Nullable<InstancedConstructor<Model>> {
    let result;
    if (typeof modelOrName === 'string') {
      result = this.constructorsByModelName.get(modelOrName)?.instancedConstructor;
    } else if (this.metaByModel.has(modelOrName as AnyClass)) {
      result = this.constructorsByModelName.get(this.getModelMeta(modelOrName)!.name)?.instancedConstructor;
    }
    return result as Nullable<ImdAnnoConstructor<InstancedConstructor<Model>>>;
  }

  private defaultCtx = new AnnoContext(this, '');
  private ctxByName: Map<string, AnnoContext> = new Map();

  getContext(contextName?: string): AnnoContext {
    if (!contextName) {
      return this.defaultCtx;
    } else {
      if (!this.ctxByName.has(contextName)) {
        this.ctxByName.set(contextName, new AnnoContext(this, contextName));
      }
      return this.ctxByName.get(contextName)!;
    }
  }

  instantiate<C extends AnyClass>(model: string | C, args?: any[], state?: any, contextName?: string) {
    const theAnnoCtx = this.getContext(contextName);
    const InstanceConstructor = theAnnoCtx.getInstanceConstructor(model);
    const modelName =
      typeof model === 'string'
        ? model
        : !!InstanceConstructor && !!InstanceConstructor[MODEL_NAME_FIELD]
        ? (InstanceConstructor[MODEL_NAME_FIELD] as string)
        : model.name;

    if (!InstanceConstructor) {
      throw new ModelNotFound(`Model ${modelName} is not found or invalid`);
    }
    args = args || [];
    const theInstance = new InstanceConstructor(...(args as ConstructorParameters<InstancedConstructor<C>>)) as InsTyp<
      C
    >;
    theAnnoCtx.addOneInstance(theInstance);

    theAnnoCtx.store.dispatch(
      registerActionHelper.create([
        {
          instance: theInstance,
          state,
        },
      ])
    );
    return theInstance;
  }

  disband(instance: AsImdAnnoInst<any>) {
    const annoCtx = this.getContext(instance.contextName);
    annoCtx.store.dispatch(unregisterActionHelper.create([instance]));

    instance.prototype = Object.prototype;
    instance.constructor = Object.prototype.constructor;

    return instance;
  }
}

const theCtxMgr = AnnoContextManager.ANNO_CTX_MGR;

export function assembleActionName(modelName: string, fieldName: string, key?: string): string {
  return !!key
    ? [modelName, key, fieldName].join(ACTION_NAME_SEPARATOR)
    : [modelName, fieldName].join(ACTION_NAME_SEPARATOR);
}

export function disassembleActionName(
  actionName: string
): Nullable<{
  modelName: string;
  key?: string;
  fieldName: string;
}> {
  const parts = actionName.split(ACTION_NAME_SEPARATOR);
  if (parts.length === 3) {
    return {
      modelName: parts[0],
      key: parts[1],
      fieldName: parts[2],
    };
  } else if (parts.length === 2) {
    return {
      modelName: parts[0],
      key: undefined,
      fieldName: parts[1],
    };
  } else {
    return void 0;
  }
}
export const instantiate = theCtxMgr.instantiate.bind(theCtxMgr);
export const disband = theCtxMgr.disband.bind(theCtxMgr);
export const getContext = theCtxMgr.getContext.bind(theCtxMgr);
