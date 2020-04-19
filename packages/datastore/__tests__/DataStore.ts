import 'fake-indexeddb/auto';
import uuidValidate from 'uuid-validate';
import {
	initSchema as initSchemaType,
	DataStore as DataStoreType,
} from '../src/datastore/datastore';
import {
	ModelInit,
	MutableModel,
	PersistentModelConstructor,
	Schema,
	NonModelTypeConstructor,
	PersistentModel,
} from '../src/types';
import { ExclusiveStorage as StorageType } from '../src/storage/storage';
import Observable from 'zen-observable-ts';
import { Predicates } from '../src/predicates';

let initSchema: typeof initSchemaType;
let DataStore: typeof DataStoreType;

beforeEach(() => {
	jest.resetModules();

	jest.doMock('../src/storage/storage', () => {
		const mock = jest.fn().mockImplementation(() => ({
			runExclusive: jest.fn(),
			query: jest.fn(),
			observe: jest.fn(() => Observable.of()),
		}));

		(<any>mock).getNamespace = () => ({ models: {} });

		return { ExclusiveStorage: mock };
	});
	({ initSchema, DataStore } = require('../src/datastore/datastore'));
});

const nameOf = <T>(name: keyof T) => name;

/**
 * Does nothing intentionally, we care only about type checking
 */
const expectType: <T>(param: T) => void = () => { };

describe('DataStore tests', () => {
	describe('initSchema tests', () => {
		test('Model class is created', () => {
			const classes = initSchema(testSchema());

			expect(classes).toHaveProperty('Model');

			const { Model } = classes as { Model: PersistentModelConstructor<Model> };

			expect(Model).toHaveProperty(nameOf<PersistentModelConstructor<any>>('copyOf'));

			expect(typeof Model.copyOf).toBe('function');
		});

		test('Model class can be instantiated', () => {
			const { Model } = initSchema(testSchema()) as {
				Model: PersistentModelConstructor<Model>;
			};

			const model = new Model({
				field1: 'something',
			});

			expect(model).toBeInstanceOf(Model);

			expect(model.id).toBeDefined();

			// syncable models use uuid v4
			expect(uuidValidate(model.id, 4)).toBe(true);
		});

		test('Non-syncable models get a uuid v1', () => {
			const { LocalModel } = initSchema(testSchema()) as {
				LocalModel: PersistentModelConstructor<Model>;
			};

			const model = new LocalModel({
				field1: 'something',
			});

			expect(model).toBeInstanceOf(LocalModel);

			expect(model.id).toBeDefined();

			/**
			 * local models use something like a uuid v1
			 * see https://github.com/kelektiv/node-uuid/issues/75#issuecomment-483756623
			 */
			expect(
				uuidValidate(model.id.replace(/^(.{4})-(.{4})-(.{8})/, '$3-$2-$1'), 1)
			).toBe(true);
		});

		test('initSchema is executed only once', () => {
			initSchema(testSchema());

			expect(() => {
				initSchema(testSchema());
			}).toThrow('The schema has already been initialized');
		});

		test('Non @model class is created', () => {
			const classes = initSchema(testSchema());

			expect(classes).toHaveProperty('Metadata');

			const { Metadata } = classes;

			expect(Metadata).not.toHaveProperty(nameOf<PersistentModelConstructor<any>>('copyOf'));
		});

		test('Non @model class can be instantiated', () => {
			const { Metadata } = initSchema(testSchema()) as {
				Metadata: NonModelTypeConstructor<Metadata>;
			};

			const metadata = new Metadata({
				author: 'some author',
				tags: [],
			});

			expect(metadata).toBeInstanceOf(Metadata);

			expect(metadata).not.toHaveProperty('id');
		});
	});

	describe('Immutability', () => {
		test('Field cannot be changed', () => {
			const { Model } = initSchema(testSchema()) as {
				Model: PersistentModelConstructor<Model>;
			};

			const model = new Model({
				field1: 'something',
			});

			expect(() => {
				(<any>model).field1 = 'edit';
			}).toThrowError("Cannot assign to read only property 'field1' of object");
		});

		test('Model can be copied+edited by creating an edited copy', () => {
			const { Model } = initSchema(testSchema()) as {
				Model: PersistentModelConstructor<Model>;
			};

			const model1 = new Model({
				field1: 'something',
			});

			const model2 = Model.copyOf(model1, draft => {
				draft.field1 = 'edited';
			});

			expect(model1).not.toBe(model2);

			// ID should be kept the same
			expect(model1.id).toBe(model2.id);

			expect(model1.field1).toBe('something');
			expect(model2.field1).toBe('edited');
		});

		test('Id cannot be changed inside copyOf', () => {
			const { Model } = initSchema(testSchema()) as {
				Model: PersistentModelConstructor<Model>;
			};

			const model1 = new Model({
				field1: 'something',
			});

			const model2 = Model.copyOf(model1, draft => {
				(<any>draft).id = 'a-new-id';
			});

			// ID should be kept the same
			expect(model1.id).toBe(model2.id);
		});

		test('Non @model - Field cannot be changed', () => {
			const { Metadata } = initSchema(testSchema()) as {
				Metadata: NonModelTypeConstructor<Metadata>;
			};

			const nonModel = new Metadata({
				author: 'something',
			});

			expect(() => {
				(<any>nonModel).author = 'edit';
			}).toThrowError("Cannot assign to read only property 'author' of object");
		});
	});

	describe('Initialization', () => {
		test('start is called only once', async () => {
			const storage: StorageType = require('../src/storage/storage')
				.ExclusiveStorage;

			const classes = initSchema(testSchema());

			const { Model } = classes as { Model: PersistentModelConstructor<Model> };

			const promises = [
				DataStore.query(Model),
				DataStore.query(Model),
				DataStore.query(Model),
				DataStore.query(Model),
			];

			await Promise.all(promises);

			expect(storage).toHaveBeenCalledTimes(1);
		});

		test('It is initialized when observing (no query)', async () => {
			const storage: StorageType = require('../src/storage/storage')
				.ExclusiveStorage;

			const classes = initSchema(testSchema());

			const { Model } = classes as { Model: PersistentModelConstructor<Model> };

			DataStore.observe(Model).subscribe(jest.fn());

			expect(storage).toHaveBeenCalledTimes(1);
		});
	});

	describe('Basic operations', () => {
		test('Save returns the saved model', async () => {
			let model: Model;

			jest.resetModules();
			jest.doMock('../src/storage/storage', () => {
				const mock = jest.fn().mockImplementation(() => ({
					runExclusive: jest.fn(() => [model]),
				}));

				(<any>mock).getNamespace = () => ({ models: {} });

				return { ExclusiveStorage: mock };
			});
			({ initSchema, DataStore } = require('../src/datastore/datastore'));

			const classes = initSchema(testSchema());

			const { Model } = classes as { Model: PersistentModelConstructor<Model> };

			model = new Model({
				field1: 'Some value',
			});

			const result = await DataStore.save(model);

			expect(result).toMatchObject(model);
		});
	});

	test("non-@models can't be saved", async () => {
		const { Metadata } = initSchema(testSchema()) as {
			Metadata: NonModelTypeConstructor<Metadata>;
		};

		const metadata = new Metadata({
			author: 'some author',
			tags: [],
		});

		await expect(DataStore.save(<any>metadata)).rejects.toThrow(
			'Object is not an instance of a valid model'
		);
	});

	describe("Type definitions", () => {
		test("query types are correct", async () => {
			let model: Model;

			jest.resetModules();
			jest.doMock('../src/storage/storage', () => {
				const mock = jest.fn().mockImplementation(() => ({
					runExclusive: jest.fn(() => [model]),
					query: jest.fn(() => [model]),
				}));

				(<any>mock).getNamespace = () => ({ models: {} });

				return { ExclusiveStorage: mock };
			});
			({ initSchema, DataStore } = require('../src/datastore/datastore'));

			const classes = initSchema(testSchema());

			const { Model } = classes as { Model: PersistentModelConstructor<Model> };

			model = new Model({
				field1: 'Some value',
			});

			const allModels = await DataStore.query(Model);
			expectType<Model[]>(allModels);

			const oneModelById = await DataStore.query(Model, 'someid');
			expectType<Model>(oneModelById);

			const [oneModelByIdWithCriteria] = await DataStore.query(Model, c => c.id('eq', 'someid'));
			expectType<Model>(oneModelByIdWithCriteria);

			const [oneModelWithCriteria] = await DataStore.query(Model, c => c.field1('eq', 'somecontent'));
			expectType<Model>(oneModelWithCriteria);

			const multiModelWithCriteria2 = await DataStore.query(Model, c => c.field1('contains', 'something'));
			expectType<Model[]>(multiModelWithCriteria2);

			const allModelsPaginatedAwait = await DataStore.query(Model, Predicates.ALL, { page: 0, limit: 20 });
			expectType<Model[]>(allModelsPaginatedAwait);
		});

		test("query types are correct (passing generic type)", async () => {
			let model: Model;

			jest.resetModules();
			jest.doMock('../src/storage/storage', () => {
				const mock = jest.fn().mockImplementation(() => ({
					runExclusive: jest.fn(() => [model]),
					query: jest.fn(() => [model]),
				}));

				(<any>mock).getNamespace = () => ({ models: {} });

				return { ExclusiveStorage: mock };
			});
			({ initSchema, DataStore } = require('../src/datastore/datastore'));

			const classes = initSchema(testSchema());

			const { Model } = classes as { Model: PersistentModelConstructor<Model> };

			model = new Model({
				field1: 'Some value',
			});

			const allModels = await DataStore.query<typeof Model>(Model);
			expectType<Model[]>(allModels);

			const oneModelById = await DataStore.query<typeof Model>(Model, 'someid');
			expectType<Model>(oneModelById);

			const [oneModelByIdWithCriteria] = await DataStore.query<typeof Model>(Model, c => c.id('eq', 'someid'));
			expectType<Model>(oneModelByIdWithCriteria);

			const [oneModelWithCriteria] = await DataStore.query<typeof Model>(Model, c => c.field1('eq', 'somecontent'));
			expectType<Model>(oneModelWithCriteria);

			const multiModelWithCriteria2 = await DataStore.query<typeof Model>(Model, c => c.field1('contains', 'something'));
			expectType<Model[]>(multiModelWithCriteria2);

			const allModelsPaginatedAwait = await DataStore.query<typeof Model>(Model, Predicates.ALL, { page: 0, limit: 20 });
			expectType<Model[]>(allModelsPaginatedAwait);
		});

		test("observe types are correct", async () => {
			let model: Model;

			jest.resetModules();
			jest.doMock('../src/storage/storage', () => {
				const mock = jest.fn().mockImplementation(() => ({
					runExclusive: jest.fn(() => [model]),
					query: jest.fn(() => [model]),
				}));

				(<any>mock).getNamespace = () => ({ models: {} });

				return { ExclusiveStorage: mock };
			});
			({ initSchema, DataStore } = require('../src/datastore/datastore'));

			const classes = initSchema(testSchema());

			const { Model } = classes as { Model: PersistentModelConstructor<Model> };

			model = new Model({
				field1: 'Some value',
			});

			// subscribe to all models
			DataStore.observe().subscribe(({ element, model }) => {
				expectType<PersistentModelConstructor<PersistentModel>>(model);
				expectType<PersistentModel>(element);
			});

			// subscribe to model instance
			DataStore.observe(model).subscribe(({ element, model }) => {
				expectType<PersistentModelConstructor<Model>>(model);
				expectType<Model>(element);
			});

			// subscribe to model
			DataStore.observe<Model>(Model).subscribe(({ element, model }) => {
				expectType<PersistentModelConstructor<Model>>(model);
				expectType<Model>(element);
			});

			// const oneModelById = await DataStore.query(Model, 'someid');
			// expectType<Model>(oneModelById);

			// const [oneModelByIdWithCriteria] = await DataStore.query(Model, c => c.id('eq', 'someid'));
			// expectType<Model>(oneModelByIdWithCriteria);

			// const [oneModelWithCriteria] = await DataStore.query(Model, c => c.field1('eq', 'somecontent'));
			// expectType<Model>(oneModelWithCriteria);

			// const multiModelWithCriteria2 = await DataStore.query(Model, c => c.field1('contains', 'something'));
			// expectType<Model[]>(multiModelWithCriteria2);

			// const allModelsPaginatedAwait = await DataStore.query(Model, Predicates.ALL, { page: 0, limit: 20 });
			// expectType<Model[]>(allModelsPaginatedAwait);
		});
	});
});

//#region Test helpers

declare class Model {
	public readonly id: string;
	public readonly field1: string;
	public readonly metadata?: Metadata;

	constructor(init: ModelInit<Model>);

	static copyOf(
		src: Model,
		mutator: (draft: MutableModel<Model>) => void | Model
	): Model;
}

export declare class Metadata {
	readonly author: string;
	readonly tags?: string[];
	constructor(init: Metadata);
}

function testSchema(): Schema {
	return {
		enums: {},
		models: {
			Model: {
				name: 'Model',
				pluralName: 'Models',
				syncable: true,
				fields: {
					id: {
						name: 'id',
						isArray: false,
						type: 'ID',
						isRequired: true,
					},
					field1: {
						name: 'field1',
						isArray: false,
						type: 'String',
						isRequired: true,
					},
					metadata: {
						name: 'metadata',
						isArray: false,
						type: {
							nonModel: 'Metadata',
						},
						isRequired: false,
						attributes: [],
					},
				},
			},
			LocalModel: {
				name: 'LocalModel',
				pluralName: 'LocalModels',
				syncable: false,
				fields: {
					id: {
						name: 'id',
						isArray: false,
						type: 'ID',
						isRequired: true,
					},
					field1: {
						name: 'field1',
						isArray: false,
						type: 'String',
						isRequired: true,
					},
				},
			},
		},
		nonModels: {
			Metadata: {
				name: 'Metadata',
				fields: {
					author: {
						name: 'author',
						isArray: false,
						type: 'String',
						isRequired: true,
						attributes: [],
					},
					tags: {
						name: 'tags',
						isArray: true,
						type: 'String',
						isRequired: false,
						attributes: [],
					},
				},
			},
		},
		version: '1',
	};
}

//#endregion
