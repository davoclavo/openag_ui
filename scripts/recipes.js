import {html, forward, Effects, Task, thunk} from 'reflex';
import * as Config from '../openag-config.json';
import * as Template from './common/stache';
import * as Database from './common/database';
import * as Request from './common/request';
import * as Indexed from './common/indexed';
import * as Unknown from './common/unknown';
import * as Banner from './common/banner';
import {merge, tag, tagged, batch, annotate, port} from './common/prelude';
import * as Modal from './common/modal';
import {cursor} from './common/cursor';
import {classed, toggle} from './common/attr';
import {localize} from './common/lang';
import {compose, constant} from './lang/functional';
import * as Form from './recipes/form';
import * as Recipe from './recipe';

// Actions and tagging functions

const TagIndexed = source => ({
  type: 'Indexed',
  source
});

const Activate = compose(TagIndexed, Indexed.Activate);

const TagModal = tag('Modal');

const TagBanner = source => ({
  type: 'Banner',
  source
});

const Notify = compose(TagBanner, Banner.Notify);
const AlertRefreshable = compose(TagBanner, Banner.AlertRefreshable);
const AlertDismissable = compose(TagBanner, Banner.AlertDismissable);
const FailRecipeStart = AlertDismissable("Couldn't start recipe");

const TagForm = action =>
  action.type === 'Back' ?
  ActivatePanel(null) :
  action.type === 'AddedRecipe' ?
  AddedRecipe(action.recipe) :
  FormAction(action);

const ConfigureForm = compose(TagForm, Form.Configure);

const FormAction = action => ({
  type: 'Form',
  source: action
});

const ClearForm = FormAction(Form.Clear);
const AlertForm = compose(FormAction, Form.Alert);

const RecipeAction = (id, action) =>
  action.type === 'Activate' ?
  StartByID(id) :
  ({
    type: 'Recipe',
    id,
    source: action
  });

const ByID = id => action =>
  RecipeAction(id, action);


// This action handles information restored from the parent.
export const Configure = origin => ({
  type: 'Configure',
  origin
});

const AddedRecipe = recipe => ({
  type: 'AddedRecipe',
  recipe
});

// Insert recipe into model
const InsertRecipe = recipe => ({
  type: 'InsertRecipe',
  recipe
});

// Restore recipes by fetching over HTTP
const RestoreRecipes = {type: 'RestoreRecipes'};

// Response from recipe restore
const RestoredRecipes = result => ({
  type: 'RestoredRecipes',
  result
});

export const Open = TagModal(Modal.Open);
export const Close = TagModal(Modal.Close);

export const StartByID = id => ({
  type: 'StartByID',
  id
});

export const RequestStart = (id, name) => ({
  type: 'RequestStart',
  id,
  name
});

export const RequestStopStart = (id, name) => ({
  type: 'RequestStopStart',
  id,
  name
});

const ActivatePanel = id => ({
  type: 'ActivatePanel',
  id
});

// An action representing "no further action".
const NoOp = Indexed.NoOp;

// Model, update and init

export const init = () => {
  const [form, formFx] = Form.init();
  const [banner, bannerFx] = Banner.init();

  return [
    {
      active: null,
      activePanel: null,
      isOpen: false,
      // Origin url
      origin: null,
      // Build an array of ordered recipe IDs
      order: [],
      // Index all recipes by ID
      entries: {},
      form,
      banner
    },
    Effects.batch([
      formFx.map(TagForm),
      bannerFx.map(TagBanner)
    ])
  ];
};

const updateIndexed = cursor({
  update: Indexed.update,
  tag: TagIndexed
});

const updateModal = cursor({
  update: Modal.update,
  tag: TagModal
});

const updateBanner = cursor({
  get: model => model.banner,
  set: (model, banner) => merge(model, {banner}),
  update: Banner.update,
  tag: TagBanner
});

const updateForm = cursor({
  get: model => model.form,
  set: (model, form) => merge(model, {form}),
  update: Form.update,
  tag: TagForm
});

// Send restore GET request to _all_docs url.
const restore = model => [
  model,
  Request.get(templateAllDocsUrl(model.origin)).map(RestoredRecipes)
];

const restoredOk = (model, resp) => {
  const recipes = Database.readAllDocs(resp).map(Recipe.fromDoc);
  const next = merge(model, {
    // Build an array of ordered recipe IDs
    order: Indexed.pluckID(recipes),
    // Index all recipes by ID
    entries: Indexed.indexByID(recipes)
  });
  return [next, Effects.none];
}

const restoredError = (model, error) => {
  const message = localize("Hmm, couldn't read from your browser's database.");
  return update(model, AlertRefreshable(message));
}

const addedRecipe = (model, recipe) =>
  batch(update, model, [
    InsertRecipe(recipe),
    ActivatePanel(null),
    Notify(localize('Recipe Added'))
  ]);

const insertRecipe = (model, recipe) => {
  const item = Recipe.fromDoc(recipe);
  return [
    Indexed.insert(model, item.id, item),
    Effects.none
  ];
}

// Activate recipe by id
const startByID = (model, id) => {
  const [next, fx] = update(model, Activate(id));
  const name = next.entries[id].name;

  return [
    next,
    Effects.batch([
      fx,
      model.active === null ?
      Effects.receive(RequestStart(id, name)) :
      Effects.receive(RequestStopStart(id, name))
    ])
  ];
}

const activatePanel = (model, id) =>
  [merge(model, {activePanel: id}), Effects.none];

const configure = (model, origin) => {
  const next = merge(model, {origin});
  return batch(update, next, [
    RestoreRecipes,
    ConfigureForm(origin)
  ]);
}

export const update = (model, action) =>
  action.type === 'Indexed' ?
  updateIndexed(model, action.source) :
  action.type === 'Banner' ?
  updateBanner(model, action.source) :
  action.type === 'Form' ?
  updateForm(model, action.source) :
  action.type === 'Modal' ?
  updateModal(model, action.source) :
  action.type === 'NoOp' ?
  [model, Effects.none] :
  action.type === 'RestoreRecipes' ?
  restore(model) :
  action.type === 'RestoredRecipes' ?
  (
    action.result.isOk ?
    restoredOk(model, action.result.value) :
    restoredError(model, action.result.error)
  ) :
  action.type === 'AddedRecipe' ?
  addedRecipe(model, action.recipe) :
  action.type === 'InsertRecipe' ?
  insertRecipe(model, action.recipe) :
  action.type === 'StartByID' ?
  startByID(model, action.id) :
  action.type === 'ActivatePanel' ?
  activatePanel(model, action.id) :
  action.type === 'Configure' ?
  configure(model, action.origin) :
  Unknown.update(model, action);

// View

export const view = (model, address) => {
  const sendModalClose = onModalClose(address);
  const sendActivateForm = onForm(address);
  return html.div({
    id: 'recipes-modal',
    className: 'modal',
    hidden: toggle(!model.isOpen, 'hidden')
  }, [
    html.div({
      className: 'modal-overlay',
      onTouchStart: sendModalClose,
      onMouseDown: sendModalClose
    }),
    html.dialog({
      className: classed({
        'modal-main': true
      }),
      open: toggle(model.isOpen, 'open')
    }, [
      html.div({
        className: classed({
          'panels--main': true,
          'panels--lv1': model.activePanel !== null
        })
      }, [
        html.div({
          className: 'panel--main panel--lv0'
        }, [
          html.header({
            className: 'panel--header'
          }, [
            html.h1({
              className: 'panel--title'
            }, [
              localize('Recipes')
            ]),
            html.div({
              className: 'panel--nav-right'
            }, [
              html.a({
                className: 'recipes-create-icon',
                onTouchStart: sendActivateForm,
                onMouseDown: sendActivateForm
              })
            ])
          ]),
          thunk(
            'recipes-banner',
            Banner.view,
            model.banner,
            forward(address, TagBanner),
            'panel--banner recipes--banner'
          ),
          html.div({
            className: 'panel--content'
          }, [
            html.ul({
              className: 'menu-list'
            }, model.order.map(id => thunk(
              id,
              Recipe.view,
              model.entries[id],
              forward(address, ByID(id))
            )))
          ])
        ]),
        thunk(
          'recipes-form',
          Form.view,
          model.form,
          forward(address, TagForm),
          model.activePanel === 'form'
        )
      ])
    ])
  ]);
}

const onModalClose = annotate(Modal.onClose, TagModal);

const onForm = port(event => {
  event.preventDefault();
  return ActivatePanel('form');
})

// Helpers

const templateAllDocsUrl = origin =>
  Template.render(Config.recipes.all_docs, {
    origin_url: origin
  });