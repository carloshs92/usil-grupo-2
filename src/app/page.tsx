"use client";

import { useChat } from "@ai-sdk/react";
import { IoSend } from "react-icons/io5";
import { FaUserCircle } from "react-icons/fa";
import { MdSportsSoccer } from "react-icons/md";
import { AiOutlineLoading3Quarters } from "react-icons/ai";
import { useEffect, useRef } from "react";

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, status } =
    useChat();

  const isAiResponding = status === "submitted" || status === "streaming";

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col h-screen bg-slate-100 dark:bg-zinc-950">
      {/* Header */}
      <header className="bg-blue-700 dark:bg-blue-800 text-white p-4 shadow-md fixed top-0 left-0 right-0 z-20">
        <h1 className="text-center text-xl font-semibold">
          Americano FC Academy Perú
        </h1>
      </header>

      {/* Messages Container */}
      <div className="flex-grow overflow-y-auto pt-20 pb-28 px-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex items-end space-x-2 justify-start ${
              message.role === "user" ? "flex-row-reverse" : "flex-row"
            }`}
          >
            {message.role !== "user" && (
              <MdSportsSoccer className="text-3xl mb-1 text-blue-600 dark:text-blue-500 flex-shrink-0" />
            )}
            <div
              className={`max-w-[70%] p-3 rounded-xl shadow ${
                message.role === "user"
                  ? "bg-sky-500 text-white rounded-br-none order-last"
                  : "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-none"
              }`}
            >
              <div className="font-bold text-sm mb-1">
                {message.role === "user" ? "Tú" : "Academia Bot"}
              </div>
              <div className="whitespace-pre-wrap text-sm break-words">
                {/* Tu lógica para message.parts es correcta */}
                {message.parts.map((part, i) => {
                  const partKey = `${message.id}-part-${i}`;
                  switch (part.type) {
                    case "text":
                      return <div key={partKey}>{part.text}</div>;
                    case "tool-invocation":
                      return (
                        <span key={`${message.id}-${i}`}>
                          {part.toolInvocation.toolName ===
                          "get_alumnos_list" ? (
                            <div className="text-sm text-red-800 dark:text-zinc-200">
                              {
                                "Obteniendo lista desde Firebase (evidencia que lista los usuarios de firebase)"
                              }
                              <br />
                            </div>
                          ) : (
                            ""
                          )}
                          {(part.toolInvocation as any)?.result?.message}
                        </span>
                      );
                  }

                  return null;
                })}
              </div>
            </div>
            {message.role === "user" && (
              <FaUserCircle className="text-3xl mb-1 text-sky-500 dark:text-sky-400 flex-shrink-0" />
            )}
          </div>
        ))}
        {isAiResponding &&
          messages[messages.length - 1]?.role === "user" && ( // <--- Cambiado aquí
            <div className="flex items-end space-x-2 rtl:space-x-reverse justify-start">
              <MdSportsSoccer className="text-3xl mb-1 text-blue-600 dark:text-blue-500 flex-shrink-0" />
              <div className="max-w-[70%] p-3 rounded-xl shadow bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-none">
                <div className="font-bold text-sm mb-1">Academia Bot</div>
                <div className="whitespace-pre-wrap text-sm flex items-center">
                  <AiOutlineLoading3Quarters className="animate-spin mr-2 text-blue-500" />
                  Escribiendo...
                </div>
              </div>
            </div>
          )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-100 dark:bg-zinc-950 p-3 border-t border-slate-300 dark:border-zinc-700 z-10">
        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-lg mx-auto items-center space-x-2"
        >
          <input
            className="flex-grow p-3 border border-slate-300 dark:border-zinc-700 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none dark:bg-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 disabled:opacity-70"
            value={input}
            placeholder="Escribe tu mensaje aquí..."
            onChange={handleInputChange}
            disabled={isAiResponding}
          />
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold p-3 rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950 disabled:opacity-70 disabled:cursor-not-allowed"
            aria-label="Enviar mensaje"
            disabled={isAiResponding || !input.trim()}
          >
            {isAiResponding ? (
              <AiOutlineLoading3Quarters className="w-5 h-5 animate-spin" />
            ) : (
              <IoSend className="w-5 h-5" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
