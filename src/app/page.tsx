"use client";

import { useChat } from "@ai-sdk/react";
import { IoSend } from "react-icons/io5"; // Send icon
import { FaUserCircle, FaRobot } from "react-icons/fa"; // User and basic Bot icon
import { MdSportsSoccer } from "react-icons/md"; // Thematic bot icon
import { AiOutlineLoading3Quarters } from "react-icons/ai"; // Loading spinner icon

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat();

  return (
    <div className="flex flex-col h-screen bg-slate-100 dark:bg-zinc-950">
      {/* Header */}
      <header className="bg-blue-700 dark:bg-blue-800 text-white p-4 shadow-md fixed top-0 left-0 right-0 z-20">
        {" "}
        {/* Increased z-index */}
        <h1 className="text-center text-xl font-semibold">
          Americano FC Academy Perú
        </h1>
      </header>

      {/* Messages Container */}
      <div className="flex-grow overflow-y-auto pt-20 pb-28 px-4 space-y-4">
        {" "}
        {/* Adjusted padding */}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex items-end space-x-2 justify-start ${
              // rtl:space-x-reverse for right-to-left support if needed
              message.role === "user" ? "flex-row-reverse" : "flex-row"
            }`}
          >
            {/* AI Avatar */}
            {message.role !== "user" && (
              <MdSportsSoccer className="text-3xl mb-1 text-blue-600 dark:text-blue-500 flex-shrink-0" />
            )}

            {/* Message Bubble */}
            <div
              className={`max-w-[70%] p-3 rounded-xl shadow ${
                message.role === "user"
                  ? "bg-sky-500 text-white rounded-br-none order-last" // User messages
                  : "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-none" // AI messages
              }`}
            >
              <div className="font-bold text-sm mb-1">
                {message.role === "user" ? "Tú" : "Academia Bot"}
              </div>
              <div className="whitespace-pre-wrap text-sm break-words">
                {message.parts.map((part, i) => {
                  if (part.type === "text") {
                    return <span key={`${message.id}-${i}`}>{part.text}</span>;
                  }
                  return null;
                })}
              </div>
            </div>

            {/* User Avatar */}
            {message.role === "user" && (
              <FaUserCircle className="text-3xl mb-1 text-sky-500 dark:text-sky-400 flex-shrink-0" />
            )}
          </div>
        ))}
        {/* Loading Indicator / Bot is typing... */}
        {isLoading &&
          messages[messages.length - 1]?.role === "user" && ( // Show only if AI is expected to reply
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
            disabled={isLoading} // Disable input when loading
          />
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold p-3 rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950 disabled:opacity-70 disabled:cursor-not-allowed"
            aria-label="Enviar mensaje"
            disabled={isLoading} // Disable button when loading
          >
            {isLoading ? (
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
