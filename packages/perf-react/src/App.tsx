import { useMediaQuery } from "react-responsive";
import Editor from "./app/Editor";
import "shared/styles/perf-app.css";
import "shared/styles/nodes-menu.css";

function App() {
  const isDesktop = useMediaQuery({ minWidth: 768 });

  return (
    <div
      className={`editors ${isDesktop ? "desktop" : "mobile"}`}
      style={{ overflowX: "auto", display: "flex", flexDirection: "column" }}
    >
      <div className="editor">
        <Editor
          {...{
            serverName: "dbl",
            organizationId: "bfbs",
            languageCode: "fra",
            versionId: "lsg",
            bookCode: "rev",
          }}
        />
      </div>
      {!isDesktop && (
        <div className="editor">
          <Editor
            {...{
              serverName: "dbl",
              organizationId: "bfbs",
              languageCode: "eng",
              versionId: "web",
              bookCode: "tit",
            }}
          />
        </div>
      )}
      {isDesktop && (
        <div className="editor">
          <Editor
            {...{
              serverName: "dbl",
              organizationId: "bfbs",
              languageCode: "eng",
              versionId: "web",
              bookCode: "tit",
            }}
          />
        </div>
      )}
    </div>
  );
}

export default App;
