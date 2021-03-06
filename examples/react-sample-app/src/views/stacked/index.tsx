import React, {useMemo, useCallback} from 'react';
import {getContext} from 'redux-anno';
import {useSelector} from 'react-redux';
import Counter from 'src/views/Counter';
import {StackedViewManager} from 'src/stores/StackedViews/StackedViewManager';
import {ViewItemSwitcher} from 'src/views/stacked/ViewItemSwitcher';

import style from 'src/views/stacked/index.module.scss';

export const StackedView = React.memo(() => {
  const defaultCtx = useMemo(getContext, []);
  const viewMgr = useMemo(() => defaultCtx.getOneInstance(StackedViewManager), [defaultCtx]);

  const handleAddWelcome = useCallback(async () => {
    await viewMgr.addWelcomeView.dispatch();
  }, [viewMgr]);
  const handleAddStepZero = useCallback(async () => {
    await viewMgr.addStepView.dispatch(0);
  }, [viewMgr]);

  const current = useSelector(() => viewMgr.current);
  const items = useSelector(() => viewMgr.items);

  return (
    <div className={style.mainView}>
      <div>
        <span>Current View Index: {current}</span>
        <button onClick={handleAddWelcome}>Add Welcome</button>
        <button onClick={handleAddStepZero}>Add Step 0</button>
        <Counter />
      </div>
      {/*todo fix this as any*/}
      <ViewItemSwitcher current={current} items={items as any} />
    </div>
  );
});

export default StackedView;
