import {Model, MODEL_TYPE, Self, createSelf, State, createState} from 'redux-anno';
import {putResolve} from 'redux-saga/effects';
import {BaseView, VIEW_TYPE} from './BaseView';

@Model(MODEL_TYPE.PROTOTYPE)
export class WelcomeView extends BaseView {
  type = VIEW_TYPE.WELCOME_VIEW;

  @State welcomeMsg = createState<string>('');

  @Self self = createSelf(WelcomeView);

  constructor() {
    super('Welcome View');
  }

  *onPostEnter() {
    yield putResolve(this.self.welcomeMsg.create(`Welcome Msg: ${this.title}`));
    return;
  }

  *onPreLeave() {
    console.log('[WelcomeView::onPreLeave]', this.title);
    return;
  }
}
